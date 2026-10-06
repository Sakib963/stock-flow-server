const crypto = require("crypto");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { holdStock, releaseHolds } = require("../../utils/stock-movement");
const { refuse_change } = require("../../order/utils/order-state");
const { recordStatusHistory, nextInvoiceNo, resolveAmountPaid } = require("../../utils/order-utils");
const { price_lines, cart_totals, insert_lines, batch_name } = require("../../utils/cart");
const { find_or_create_customer } = require("../../customer/utils/find-or-create");
const { insert_address, describe_address } = require("../../customer/utils/address");
const { customer_stats } = require("../../customer/utils/customer-history");

const PAYMENT_STATUS = { COD: "unpaid", ADVANCE: "partially_paid", PREPAID: "paid" };

// Only the person whose press already placed this order is told it is placed: a draft someone else
// discarded or placed first must not read as this person's success.
const refuse_existing = async (tx, oid, user_id) => {
    const [order] = await tx.get_data({ text: `SELECT invoice_no, status, created_by, edited_by FROM ${TABLE.ORDERS} WHERE oid = $1`, values: [oid] });
    const mine = order && !["Draft", "Cancelled"].includes(order.status) && (order.edited_by ?? order.created_by) === user_id;
    if (mine) fail(409, `This order is already placed as ${order.invoice_no}. Nothing was created twice.`, { invoice_no: order.invoice_no, status: order.status });
    fail(409, "This draft was placed or discarded by someone else. Check the drafts and the orders list.", { reason: "taken" });
};

// The address the parcel goes to: a saved one of this customer's, or a new one saved to them now.
const address_for = async (tx, customer_oid, address, user_id) => {
    if (address.oid) {
        const [saved] = await tx.get_data({
            text: `SELECT oid, recipient_name, recipient_phone, address_line, district_oid, thana_oid, area_oid, area_text, postal_code
                     FROM ${TABLE.CUSTOMER_ADDRESS} WHERE oid = $1 AND customer_oid = $2 AND status = 'Active'`,
            values: [address.oid, customer_oid],
        });
        if (!saved) fail(409, "That address was removed from this customer. Pick another or add it again.", { field: "address" });
        return { ...saved, created: false };
    }
    const { oid } = await insert_address(tx, customer_oid, address, user_id);
    return { ...address, oid, created: true };
};

// An online order (sales REQ-36 to REQ-43, REQ-115): priced from the batches as at the counter, its
// discount the sum of the line discounts, created Pending with every line's stock held, and the
// customer and a new address saved in the same transaction. Nothing physical moves until dispatch.
// Editing a Pending order (REQ-52) is the same write over the existing order: its holds are released
// and taken again for the new lines in one transaction, and it keeps its invoice number and tracking link.
const write_online_order = (editing) => async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    try {
        const order = await execute_transaction(async (tx) => {
            let kept = null;
            if (editing) {
                [kept] = await tx.get_data({ text: `SELECT invoice_no, tracking_token FROM ${TABLE.ORDERS} WHERE oid = $1 AND channel = 'ONLINE' AND status = 'Pending' FOR UPDATE`, values: [payload.oid] });
                if (!kept) await refuse_change(tx, payload.oid, "edited");
                // Released first, so the order's own units count as sellable when its lines are held again.
                await releaseHolds(tx, { order_oid: payload.oid, user_id });
                // The released holds stay on the order as its record, but let go of the lines that are about to be replaced.
                await tx.execute_value({ text: `UPDATE ${TABLE.STOCK_HOLD} SET order_item_oid = NULL WHERE order_oid = $1 AND status = 'Released'`, values: [payload.oid] });
            }
            const lines = await price_lines(tx, payload.lines);
            const totals = cart_totals(lines);
            const total_amount = totals.total_amount + payload.delivery_charge;
            if (total_amount !== payload.total_amount) {
                fail(409, `The total is now ${total_amount}, not ${payload.total_amount}. A price changed: check the order and confirm again.`, {
                    total_amount,
                    lines: lines.map((l) => ({ inventory_oid: l.inventory_oid, unit_price: l.unit_price })),
                });
            }

            const payment_status = PAYMENT_STATUS[payload.payment_type];
            const amount_paid = resolveAmountPaid({ payment_status, total_amount, amount_paid: payload.amount_paid });
            if (payment_status === "partially_paid" && amount_paid === total_amount) fail(400, `That advance covers the whole total of ${total_amount}. Mark the order prepaid instead.`, { field: "amount_paid" });

            const [source] = await tx.get_data({ text: `SELECT oid FROM ${TABLE.ORDER_SOURCE} WHERE oid = $1 AND status = 'Active'`, values: [payload.source_oid] });
            if (!source) fail(400, "That source is no longer in use. Pick where the order came from again.", { field: "source_oid" });

            const found = await find_or_create_customer(tx, payload.customer, request);
            // Locked before its address is written, as every address write does.
            const [customer] = await tx.get_data({ text: `SELECT oid, name, phone_normalized AS phone, flag, flag_reason FROM ${TABLE.CUSTOMERS} WHERE oid = $1 FOR UPDATE`, values: [found.oid] });
            if (customer.flag === "Blocked" && !payload.blocked_acknowledged) {
                fail(409, `${customer.name} is blocked: ${customer.flag_reason}. Tick that you know before placing the order.`, { field: "blocked_acknowledged", flag_reason: customer.flag_reason });
            }
            // Gender and age describe the buyer and are only filled in, never overwritten from an order (REQ-63, REQ-64); the first source is the first order's (REQ-65).
            await tx.execute_value({
                text: `UPDATE ${TABLE.CUSTOMERS}
                          SET gender = COALESCE(gender, $2::text), age_band = COALESCE(age_band, $3::text), first_source_oid = COALESCE(first_source_oid, $4::text), edited_by = $5, edited_on = clock_timestamp()
                        WHERE oid = $1 AND (gender IS NULL AND $2::text IS NOT NULL OR age_band IS NULL AND $3::text IS NOT NULL OR first_source_oid IS NULL)`,
                values: [customer.oid, payload.customer.gender, payload.customer.age_band, source.oid, user_id],
            });

            const address = await address_for(tx, customer.oid, payload.address, user_id);
            const [district] = await tx.get_data({ text: `SELECT division_oid FROM ${TABLE.DISTRICT} WHERE oid = $1`, values: [address.district_oid] });
            const risk = await customer_stats(customer.oid, ["POS", "ONLINE"], (query) => tx.get_data(query));

            const order_oid = payload.oid;
            // The invoice carries a QR to the public tracker from the start, so a parcel packed before Confirm can be traced.
            const tracking_token = kept?.tracking_token ?? crypto.randomBytes(16).toString("hex");
            const header = [customer.oid, customer.name, customer.phone, address.address_line, totals.subtotal, totals.discount_total, payload.delivery_charge, total_amount, amount_paid, payload.payment_type, payload.payment_type === "COD" ? "cod" : payload.payment_method, payload.payment_reference, payment_status, payload.notes, tracking_token, user_id];
            // A saved draft becomes the order under its own oid and invoice number (REQ-42).
            const converted = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS}
                          SET customer_oid = $1, customer_name = $2, customer_phone = $3, customer_address = $4, subtotal = $5, discount_total = $6, delivery_charge = $7, total_amount = $8,
                              amount_paid = $9, payment_type = $10, payment_method = $11, payment_reference = $12, payment_status = $13, notes = $14, tracking_token = $15,
                              edited_by = $16, edited_on = clock_timestamp(), status = 'Pending', draft_label = NULL
                        WHERE oid = $17 AND channel = 'ONLINE' AND status = $18
                    RETURNING invoice_no`,
                values: [...header, order_oid, editing ? "Pending" : "Draft"],
            });
            let invoice_no = converted.rows[0]?.invoice_no;
            if (converted.rowCount === 1) {
                await tx.execute_value({ text: `DELETE FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`, values: [order_oid] });
                await tx.execute_value({ text: `DELETE FROM ${TABLE.ONLINE_ORDER} WHERE order_oid = $1`, values: [order_oid] });
            } else if (editing) {
                await refuse_change(tx, order_oid, "edited");
            } else {
                invoice_no = await nextInvoiceNo(tx.get_data);
                const created = await tx.execute_value({
                    text: `INSERT INTO ${TABLE.ORDERS}
                               (customer_oid, customer_name, customer_phone, customer_address, subtotal, discount_total, delivery_charge, total_amount,
                                amount_paid, payment_type, payment_method, payment_reference, payment_status, notes, tracking_token, created_by, oid, invoice_no, channel, status)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'ONLINE', 'Pending')
                           ON CONFLICT (oid) DO NOTHING`,
                    values: [...header, order_oid, invoice_no],
                });
                if (created.rowCount !== 1) await refuse_existing(tx, order_oid, user_id);
            }
            const placed_from_draft = !editing && converted.rowCount === 1;

            // The order keeps its own copy of where it went: editing the address later never moves a past parcel (REQ-62).
            await tx.execute_value({
                text: `INSERT INTO ${TABLE.ONLINE_ORDER}
                           (order_oid, customer_address_oid, recipient_name, recipient_phone, address_line, division_oid, district_oid, thana_oid, area_oid, area_text, postal_code,
                            source_oid, risk_own_delivered_rate, risk_flag, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
                values: [order_oid, address.oid, address.recipient_name, address.recipient_phone ?? customer.phone, address.address_line, district?.division_oid ?? null, address.district_oid, address.thana_oid, address.area_oid, address.area_text, address.postal_code, source.oid, risk.delivered_rate, customer.flag, user_id],
            });

            await insert_lines(tx, order_oid, lines);
            // Batches in one order, so two orders holding the same two batches cannot each wait on the other.
            for (const line of [...lines].sort((a, b) => a.inventory_oid.localeCompare(b.inventory_oid))) {
                const hold = await holdStock(tx, { order_oid, order_item_oid: line.oid, product_oid: line.product_oid, inventory_oid: line.inventory_oid, quantity: line.quantity, user_id });
                if (!hold.ok) fail(409, `Only ${Math.max(hold.sellable, 0)} left of ${batch_name(line)}. Reduce or remove the line.`, { inventory_oid: line.inventory_oid, sellable: Math.max(hold.sellable, 0) });
            }

            const placed = editing ? "Online order edited" : placed_from_draft ? "Online draft placed" : "Online order placed";
            await recordStatusHistory(tx, { order_oid, from_status: editing ? "Pending" : placed_from_draft ? "Draft" : null, to_status: "Pending", reason: placed, user_id });
            if (address.created) await saveLogActivity({ reference_type: "customer", reference_oid: customer.oid, title: "Added address", description: describe_address(address) }, { tx, request });
            await saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: placed, description: `${invoice_no}, ${lines.length} line(s), total ${total_amount}, stock held` }, { tx, request });
            if (customer.flag === "Blocked") await saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Placed for a blocked customer", description: `${customer.name}: ${customer.flag_reason}` }, { tx, request });
            return { oid: order_oid, invoice_no, customer_oid: customer.oid, total_amount, amount_paid, tracking_token };
        });

        log.info(`Online order ${order.invoice_no} ${editing ? "edited" : "placed"} by ${user_id}`);
        return res.status(200).json({ code: 200, message: editing ? "Order changed and its stock held again" : "Order placed and stock held", data: order });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while ${editing ? "editing" : "placing"} an online order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: editing ? "The order was not changed. Try again in a moment." : "The order was not placed and no stock was held. Try again in a moment." });
    }
};

module.exports = { create_online_order: write_online_order(false), edit_online_order: write_online_order(true) };
