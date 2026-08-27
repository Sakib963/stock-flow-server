const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { RETURNABLE_ORDER_STATUS, refundPerUnit, getPendingReturnQty, getCommittedRefund, effectiveAmountPaid, splitReturnValue, nextReturnNo } = require("../../../../utils/return-utils");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

// Raise a return against a realized order (POS Purchased, online Delivered, or
// PartiallyReturned when units are still outstanding).
//
// This RECORDS the return as Pending and moves NOTHING: inventory, returned_qty,
// the order status and product stats are all untouched until confirm-return runs.
// That is deliberate -- a return entered by mistake can be cancelled with no
// trace, which is impossible once stock has moved.
const create_return = async (request, res) => {
    const user_id = request.credentials.user_id;
    const { order_oid, refund_delivery_charge = false, return_reason, note } = request.body;
    const items = request.body.items;

    try {
        const outcome = await execute_transaction(async (tx) => {
            // Lock the order so its lines cannot be returned against concurrently.
            const orderRows = await tx.get_data({
                text: `SELECT invoice_no, status, channel, payment_status,
                              CAST(delivery_charge AS INTEGER) AS delivery_charge,
                              CAST(total_amount AS INTEGER) AS total_amount,
                              CAST(COALESCE(amount_paid, 0) AS INTEGER) AS amount_paid
                         FROM ${TABLE.ORDERS} WHERE oid = $1 FOR UPDATE`,
                values: [order_oid],
            });
            if (!orderRows.length) fail(404, "Order not found");
            const order = orderRows[0];
            if (!RETURNABLE_ORDER_STATUS.includes(order.status)) {
                fail(409, `Only a completed sale can be returned (this order is ${order.status})`);
            }

            const lineRows = await tx.get_data({
                text: `SELECT oid, product_oid, inventory_oid, product_name,
                              CAST(quantity AS INTEGER) AS quantity,
                              CAST(returned_qty AS INTEGER) AS returned_qty,
                              CAST(unit_price AS INTEGER) AS unit_price,
                              CAST(COALESCE(discount, 0) AS INTEGER) AS discount
                         FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`,
                values: [order_oid],
            });
            const lineByOid = new Map(lineRows.map((r) => [r.oid, r]));
            const pendingByLine = await getPendingReturnQty(tx, order_oid);

            // Validate every requested line against what is genuinely still
            // returnable: sold minus already returned minus already claimed by an
            // open return.
            const seen = new Set();
            const validated = [];
            for (const it of items) {
                const line = lineByOid.get(it.order_item_oid);
                if (!line) fail(400, "A return line does not belong to this order");
                if (seen.has(it.order_item_oid)) fail(400, `"${line.product_name}" is listed twice. Combine it into one line`);
                seen.add(it.order_item_oid);

                const returnable = line.quantity - line.returned_qty - (pendingByLine.get(line.oid) || 0);
                if (it.quantity > returnable) {
                    const claimed = pendingByLine.get(line.oid) || 0;
                    const because = claimed ? ` (${claimed} already on an unconfirmed return)` : "";
                    fail(400, `Cannot return ${it.quantity} of "${line.product_name}", only ${Math.max(0, returnable)} can still be returned${because}`);
                }
                if (!line.inventory_oid) fail(400, `"${line.product_name}" has no batch to return against`);
                validated.push({ ...it, line });
            }

            // Delivery is a service that was performed, so a partial return never
            // refunds it. The toggle is only honoured when every unit still
            // outstanding on the order is coming back on this return.
            const outstanding_after = lineRows.reduce((sum, line) => {
                const requested = validated.find((v) => v.line.oid === line.oid)?.quantity || 0;
                return sum + (line.quantity - line.returned_qty - requested);
            }, 0);
            const is_full_return = outstanding_after === 0;
            if (refund_delivery_charge && !is_full_return) {
                fail(400, "The delivery charge can only be refunded when the whole order is coming back");
            }

            // What the goods are worth: exactly what the customer was charged for
            // them, which is unit_price less the per-unit discount applied at sale.
            const items_value = validated.reduce((sum, v) => sum + v.quantity * refundPerUnit(v.line), 0);
            const return_value = items_value + (refund_delivery_charge ? order.delivery_charge : 0);

            // The shop can only give back what it took. On an unpaid or partly paid
            // order the rest of the value is not a refund, it just cancels part of
            // what the customer still owes.
            const already_committed = await getCommittedRefund(tx, order_oid);
            const paid = effectiveAmountPaid(order);
            const { refund_due, due_reduction } = splitReturnValue({ return_value, amount_paid: paid, already_committed });

            const return_no = await nextReturnNo(tx, { order_oid, invoice_no: order.invoice_no });
            const return_oid = uuidv4();

            await tx.execute_value({
                text: `INSERT INTO ${TABLE.PRODUCT_RETURN}
                           (oid, order_oid, invoice_no, refund_amount, refund_delivery_charge, return_reason, notes, status, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8)`,
                values: [return_oid, order_oid, return_no, refund_due, !!refund_delivery_charge, return_reason, note || null, user_id],
            });

            // `action` and `dispose_oid` stay null: nothing has been restocked or
            // disposed yet. confirm-return fills them in.
            for (const v of validated) {
                await tx.execute_value({
                    text: `INSERT INTO ${TABLE.RETURN_DETAILS}
                               (oid, return_oid, order_item_oid, product_oid, inventory_oid, return_quantity, condition)
                           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    values: [uuidv4(), return_oid, v.line.oid, v.line.product_oid, v.line.inventory_oid, v.quantity, v.condition],
                });
            }

            return { return_oid, return_no, return_value, refund_due, due_reduction, line_count: validated.length, units: validated.reduce((s, v) => s + Number(v.quantity), 0) };
        });

        const money = outcome.due_reduction > 0 ? `refund ${outcome.refund_due}, customer due reduced by ${outcome.due_reduction}` : `refund ${outcome.refund_due}`;
        saveLogActivity({
            reference_type: "order",
            reference_oid: order_oid,
            title: "Return Raised",
            description: `${outcome.return_no}: ${outcome.units} unit(s) across ${outcome.line_count} line(s), worth ${outcome.return_value} (${money}). Awaiting confirmation`,
            performed_by: user_id,
        });

        log.info(`Return ${outcome.return_no} raised by ${user_id} (Pending, no stock movement)`);
        return res.status(200).json({
            code: 200,
            message: "Return recorded. Confirm it to restock and dispose the units",
            data: {
                return_oid: outcome.return_oid,
                return_no: outcome.return_no,
                return_value: outcome.return_value,
                refund_amount: outcome.refund_due,
                due_reduction: outcome.due_reduction,
                status: "Pending",
            },
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while raising a return: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = create_return;
