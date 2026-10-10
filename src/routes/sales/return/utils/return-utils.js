const { TABLE } = require("../../../../utils/constant");
const { fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");

// A parcel that never arrived is Confirmed with delivery Failed, and only Not delivered returns it.
const RETURNABLE_ORDER_STATUS = ["Purchased", "Delivered", "PartiallyReturned"];

const refundPerUnit = (line) => Math.max(0, Number(line.unit_price || 0) - Number(line.discount || 0));

// Units of each order line claimed by a Pending return. returned_qty counts confirmed returns only,
// so without this two open returns could claim the same unit.
const getPendingReturnQty = async (tx, order_oid) => {
    const rows = await tx.get_data({
        text: `SELECT rd.order_item_oid, COALESCE(SUM(rd.return_quantity), 0)::int AS pending_qty
                 FROM ${TABLE.RETURN_DETAILS} rd
                 JOIN ${TABLE.PRODUCT_RETURN} pr ON pr.oid = rd.return_oid
                WHERE pr.order_oid = $1 AND pr.status = 'Pending'
                GROUP BY rd.order_item_oid`,
        values: [order_oid],
    });
    return new Map(rows.map((r) => [r.order_item_oid, Number(r.pending_qty)]));
};

// payment_status is authoritative, not amount_paid (CLAUDE.md, Money). Once part of it has been
// given back the status says refunded and amount_paid is the figure that was received.
const effectiveAmountPaid = ({ payment_status, total_amount, amount_paid }) => {
    if (payment_status === "paid") return Number(total_amount || 0);
    if (payment_status === "unpaid") return 0;
    return Number(amount_paid || 0);
};

// What the business still holds and has not promised back: received, less refunds sent, less refunds
// owed on the order, less what Pending returns have already spoken for.
const refundableNow = (order, pending_refunds) => Math.max(0, effectiveAmountPaid(order) - Number(order.amount_refunded || 0) - Number(order.refund_due || 0) - Number(pending_refunds || 0));

// A return is worth what the customer was charged for it, but only money received can go back. On an
// unpaid or part paid order the rest only lowers what the customer still owes.
const splitReturnValue = ({ return_value, refundable }) => {
    const refund_due = Math.max(0, Math.min(return_value, refundable));
    return { return_value, refund_due, due_reduction: return_value - refund_due };
};

// <invoice_no>-R<n>, counting cancelled returns too, so a number is never reused.
const nextReturnNo = async (tx, { order_oid, invoice_no }) => {
    const rows = await tx.get_data({ text: `SELECT COUNT(*)::int AS n FROM ${TABLE.PRODUCT_RETURN} WHERE order_oid = $1`, values: [order_oid] });
    return `${invoice_no}-R${rows[0].n + 1}`;
};

// The caller locks the order. No items means every unit still out: what a parcel that came back holds.
const raiseReturn = async (tx, request, { oid, order, items, return_reason, not_delivered_reason = null, refund_delivery_charge = false, note = null }) => {
    const lineRows = await tx.get_data({
        text: `SELECT oid, product_oid, inventory_oid, product_name, quantity::int AS quantity, returned_qty::int AS returned_qty,
                      unit_price::int AS unit_price, COALESCE(discount, 0)::int AS discount
                 FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`,
        values: [order.oid],
    });
    const pendingByLine = await getPendingReturnQty(tx, order.oid);
    const outstanding = (line) => line.quantity - line.returned_qty - (pendingByLine.get(line.oid) || 0);
    const requested = items.length ? items : lineRows.filter((line) => outstanding(line) > 0).map((line) => ({ order_item_oid: line.oid, quantity: outstanding(line), condition: "Good" }));
    if (!requested.length) fail(409, `Every unit of ${order.invoice_no} is already on a return.`);

    const lineByOid = new Map(lineRows.map((r) => [r.oid, r]));
    const seen = new Set();
    const validated = requested.map((it) => {
        const line = lineByOid.get(it.order_item_oid);
        if (!line) fail(400, "A return line does not belong to this order.");
        if (seen.has(it.order_item_oid)) fail(400, `"${line.product_name}" is listed twice. Combine it into one line.`);
        seen.add(it.order_item_oid);
        if (it.quantity > outstanding(line)) {
            const claimed = pendingByLine.get(line.oid) || 0;
            fail(409, `Only ${Math.max(0, outstanding(line))} of "${line.product_name}" can still be returned${claimed ? ` (${claimed} already on a return waiting to be confirmed)` : ""}.`);
        }
        return { ...it, line };
    });

    // Delivery is a service that was performed, so only a return of everything still out can give it back.
    const is_full = lineRows.every((line) => outstanding(line) === (validated.find((v) => v.line.oid === line.oid)?.quantity || 0));
    if (refund_delivery_charge && !is_full) fail(400, "The delivery charge goes back only when the whole order comes back.");

    const items_value = validated.reduce((sum, v) => sum + v.quantity * refundPerUnit(v.line), 0);
    const return_value = items_value + (refund_delivery_charge ? Number(order.delivery_charge || 0) : 0);
    const [{ pending_refunds }] = await tx.get_data({ text: `SELECT COALESCE(SUM(refund_amount), 0)::int AS pending_refunds FROM ${TABLE.PRODUCT_RETURN} WHERE order_oid = $1 AND status = 'Pending'`, values: [order.oid] });
    // When everything comes back and the delivery charge is kept, the money held must still cover it: an
    // advance on a refused parcel goes back less the delivery charge (decided by the user, 2026-10-10).
    const kept_delivery = is_full && !refund_delivery_charge ? Number(order.delivery_charge || 0) : 0;
    const { refund_due, due_reduction } = splitReturnValue({ return_value, refundable: Math.max(0, refundableNow(order, pending_refunds) - kept_delivery) });

    const return_no = await nextReturnNo(tx, { order_oid: order.oid, invoice_no: order.invoice_no });
    const user_id = request.credentials.user_id;
    await tx.execute_value({
        text: `INSERT INTO ${TABLE.PRODUCT_RETURN} (oid, order_oid, invoice_no, refund_amount, refund_delivery_charge, return_reason, not_delivered_reason, notes, status, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending', $9)`,
        values: [oid, order.oid, return_no, refund_due, !!refund_delivery_charge, return_reason, not_delivered_reason, note || null, user_id],
    });
    for (const v of validated) {
        await tx.execute_value({
            text: `INSERT INTO ${TABLE.RETURN_DETAILS} (oid, return_oid, order_item_oid, product_oid, inventory_oid, return_quantity, condition) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6)`,
            values: [oid, v.line.oid, v.line.product_oid, v.line.inventory_oid, v.quantity, v.condition],
        });
    }

    const units = validated.reduce((sum, v) => sum + v.quantity, 0);
    await saveLogActivity({ reference_type: "order", reference_oid: order.oid, title: "Return raised", description: `${return_no}: ${units} unit(s), worth ${return_value}, refund ${refund_due}. Waiting to be confirmed` }, { tx, request });
    return { return_oid: oid, return_no, return_value, refund_amount: refund_due, due_reduction, units };
};

module.exports = { RETURNABLE_ORDER_STATUS, refundPerUnit, getPendingReturnQty, effectiveAmountPaid, refundableNow, splitReturnValue, nextReturnNo, raiseReturn };
