const { TABLE } = require("../../../utils/constant");
const { fail } = require("../../../db/database");
const { saveLogActivity } = require("../../../utils/activity-logger");
const { deductHeldStock, incrementProductStat } = require("./stock-movement");
const { sendOrderGifts } = require("./order-gifts");
const { recordStatusHistory, resolveAmountPaid } = require("./order-utils");
const { refuse_change } = require("../order/utils/order-state");

// One order's dispatch and delivery. A parcel leaves only in a delivery batch (decided by the user,
// 2026-10-12), which calls these per order inside its own transaction; each changes the order only
// from the state it leaves.

// Dispatch (sales REQ-54): the parcel leaves with the courier, so the held units leave the shelf now,
// each batch through the stock helpers with a "dispatched" movement. The order stays Confirmed
// (REQ-112); after this it can no longer be cancelled, only returned.
const dispatchOrder = async (tx, { oid, courier, consignment_no = null, batch_no = null, user_id, request }) => {
    const dispatched = await tx.execute_value({
        text: `UPDATE ${TABLE.ORDERS} o SET dispatched_on = clock_timestamp(), edited_by = $1, edited_on = clock_timestamp()
                 FROM ${TABLE.ONLINE_ORDER} oo
                WHERE o.oid = $2 AND oo.order_oid = o.oid AND o.channel = 'ONLINE' AND o.status = 'Confirmed' AND o.dispatched_on IS NULL AND oo.delivery_status IN ('Preparing', 'Packed')
            RETURNING o.invoice_no, oo.delivery_status`,
        values: [user_id, oid],
    });
    if (dispatched.rowCount !== 1) await refuse_change(tx, oid, "dispatched");
    const { invoice_no, delivery_status } = dispatched.rows[0];
    const deducted = await deductHeldStock(tx, { order_oid: oid, user_id });
    if (!deducted.ok) fail(409, `The stock held for ${invoice_no} is no longer on the shelf. Nothing was dispatched; check the batch with a stock count.`);
    await sendOrderGifts(tx, { order_oid: oid, invoice_no, user_id, request });
    const parcel = await tx.execute_value({
        text: `UPDATE ${TABLE.ONLINE_ORDER} SET delivery_status = 'WithCourier', courier = $1, consignment_no = $2, edited_by = $3, edited_on = clock_timestamp() WHERE order_oid = $4 AND delivery_status IN ('Preparing', 'Packed')`,
        values: [courier, consignment_no, user_id, oid],
    });
    if (parcel.rowCount !== 1) await refuse_change(tx, oid, "dispatched");
    const via = [courier, consignment_no, batch_no && `batch ${batch_no}`].filter(Boolean).join(" ");
    await recordStatusHistory(tx, { order_oid: oid, kind: "Delivery", from_status: delivery_status, to_status: "WithCourier", reason: via, user_id });
    await saveLogActivity({ reference_type: "order", reference_oid: oid, title: "Online order dispatched", description: `${invoice_no}, ${via}` }, { tx, request });
    return invoice_no;
};

// Deliver (sales REQ-55, REQ-120): the customer has the parcel, so the order becomes a sale now and
// `sold_on` is written once. The courier collected what was left, so COD and Advance become paid in
// full through resolveAmountPaid. No stock moves: it left at dispatch.
const deliverOrder = async (tx, { oid, batch_no = null, user_id, request }) => {
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
    await recordStatusHistory(tx, { order_oid: oid, kind: "Delivery", from_status: "WithCourier", to_status: "Delivered", reason: batch_no ? `batch ${batch_no}` : null, user_id });
    await saveLogActivity({ reference_type: "order", reference_oid: oid, title: "Online order delivered", description: batch_no ? `${invoice_no}, batch ${batch_no}` : invoice_no }, { tx, request });
    return invoice_no;
};

module.exports = { dispatchOrder, deliverOrder };
