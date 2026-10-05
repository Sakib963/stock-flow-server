const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { incrementProductStat } = require("../../utils/stock-movement");
const { recordStatusHistory, resolveAmountPaid } = require("../../utils/order-utils");
const { refuse_change } = require("../utils/order-state");

// Deliver (sales REQ-55, REQ-120): the customer has the parcel, so the order becomes a sale now and
// `sold_on` is written once. The courier collected what was left, so COD and Advance become paid in
// full through resolveAmountPaid. No stock moves: it left at dispatch.
const deliver_order = async (request, res) => {
    const { oid } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const invoice_no = await execute_transaction(async (tx) => {
            const delivered = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS} o SET status = 'Delivered', delivered_on = clock_timestamp(), sold_on = clock_timestamp(), edited_by = $1, edited_on = clock_timestamp()
                         FROM ${TABLE.ONLINE_ORDER} oo
                        WHERE o.oid = $2 AND oo.order_oid = o.oid AND o.channel = 'ONLINE' AND o.status = 'Confirmed' AND o.dispatched_on IS NOT NULL AND o.sold_on IS NULL AND oo.delivery_status = 'WithCourier'
                    RETURNING o.invoice_no, o.payment_status, o.total_amount`,
                values: [user_id, oid],
            });
            if (delivered.rowCount !== 1) await refuse_change(tx, oid, "marked delivered");
            const { invoice_no, payment_status, total_amount } = delivered.rows[0];

            // Guarded too: a Not delivered recorded a moment ago holds this row, and a failed parcel is never a sale.
            const parcel = await tx.execute_value({ text: `UPDATE ${TABLE.ONLINE_ORDER} SET delivery_status = 'Delivered', edited_by = $1, edited_on = clock_timestamp() WHERE order_oid = $2 AND delivery_status = 'WithCourier'`, values: [user_id, oid] });
            if (parcel.rowCount !== 1) await refuse_change(tx, oid, "marked delivered");
            if (payment_status !== "paid") {
                await tx.execute_value({ text: `UPDATE ${TABLE.ORDERS} SET payment_status = 'paid', amount_paid = $1, edited_by = $3, edited_on = clock_timestamp() WHERE oid = $2`, values: [resolveAmountPaid({ payment_status: "paid", total_amount }), oid, user_id] });
                await recordStatusHistory(tx, { order_oid: oid, kind: "Payment", from_status: payment_status, to_status: "paid", reason: "Collected by the courier", user_id });
            }
            const lines = await tx.get_data({ text: `SELECT product_oid, quantity::int AS quantity FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`, values: [oid] });
            for (const line of lines) await incrementProductStat(tx, { product_oid: line.product_oid, column: "total_sold", quantity: line.quantity, user_id });

            await recordStatusHistory(tx, { order_oid: oid, from_status: "Confirmed", to_status: "Delivered", user_id });
            await recordStatusHistory(tx, { order_oid: oid, kind: "Delivery", from_status: "WithCourier", to_status: "Delivered", user_id });
            await saveLogActivity({ reference_type: "order", reference_oid: oid, title: "Online order delivered", description: invoice_no }, { tx, request });
            return invoice_no;
        });
        log.info(`Online order ${invoice_no} delivered, recorded by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Delivered", data: { oid, invoice_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while delivering an order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The order was not marked delivered. Try again in a moment." });
    }
};

module.exports = deliver_order;
