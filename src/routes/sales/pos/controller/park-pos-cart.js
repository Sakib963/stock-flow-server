const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { recordStatusHistory, nextInvoiceNo } = require("../../utils/order-utils");
const { price_lines, cart_totals, insert_lines } = require("../utils/cart");

// A parked cart is a POS Draft (sales REQ-18, REQ-19): it survives a refresh and other counters see
// it, and it holds no stock, so a customer who walks away blocks nobody. The phone and name are kept
// as typed; the customer is only found or created when the cart is checked out.
const park_pos_cart = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    try {
        const parked = await execute_transaction(async (tx) => {
            const lines = await price_lines(tx, payload.lines);
            const totals = cart_totals(lines);
            const header = [payload.draft_label, payload.customer_name, payload.customer_phone, totals.subtotal, totals.discount_total, totals.total_amount, payload.notes, user_id];

            // Parking the same cart again, or a retried park, updates the one Draft instead of adding a second.
            const order_oid = payload.oid;
            const updated = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS}
                          SET draft_label = $1, customer_name = $2, customer_phone = $3, subtotal = $4, discount_total = $5, total_amount = $6, notes = $7,
                              edited_by = $8, edited_on = clock_timestamp()
                        WHERE oid = $9 AND channel = 'POS' AND status = 'Draft'
                    RETURNING invoice_no`,
                values: [...header, order_oid],
            });
            let invoice_no = updated.rows[0]?.invoice_no;
            if (updated.rowCount === 1) {
                await tx.execute_value({ text: `DELETE FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`, values: [order_oid] });
            } else {
                invoice_no = await nextInvoiceNo(tx.get_data);
                const created = await tx.execute_value({
                    text: `INSERT INTO ${TABLE.ORDERS} (draft_label, customer_name, customer_phone, subtotal, discount_total, total_amount, notes, created_by, oid, invoice_no, channel, delivery_charge, status)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'POS', 0, 'Draft')
                           ON CONFLICT (oid) DO NOTHING`,
                    values: [...header, order_oid, invoice_no],
                });
                if (created.rowCount !== 1) fail(409, "This cart was already checked out or discarded at another counter.");
                await recordStatusHistory(tx, { order_oid, from_status: null, to_status: "Draft", reason: "Cart parked", user_id });
            }

            await insert_lines(tx, order_oid, lines);
            const label = payload.draft_label ? ` "${payload.draft_label}"` : "";
            await saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: updated.rowCount === 1 ? "Updated parked cart" : "Parked cart", description: `${invoice_no}${label}, ${lines.length} line(s), total ${totals.total_amount}` }, { tx, request });
            return { oid: order_oid, invoice_no, total_amount: totals.total_amount };
        });

        log.info(`POS cart ${parked.invoice_no} parked by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Cart parked", data: parked });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while parking a POS cart: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The cart was not parked. Try again in a moment." });
    }
};

module.exports = park_pos_cart;
