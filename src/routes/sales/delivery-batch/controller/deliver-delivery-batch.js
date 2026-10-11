const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { deliverOrder } = require("../../utils/order-moves");

// Mark delivered (REQ-09): the ticked orders still with the courier are delivered as each would be on
// its own record. The unticked stay with the courier for Not delivered on their record.
const deliver_delivery_batch = async (request, res) => {
    const { oid, order_oids } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const outcome = await execute_transaction(async (tx) => {
            const [batch] = await tx.get_data({ text: `SELECT batch_no, status FROM ${TABLE.DELIVERY_BATCH} WHERE oid = $1 FOR UPDATE`, values: [oid] });
            if (!batch) fail(404, "No delivery batch with that number.");
            if (batch.status !== "HandedOver") fail(409, `${batch.batch_no} has not been handed to the courier, so nothing in it can be delivered.`, { status: batch.status });
            const orders = await tx.get_data({
                text: `SELECT o.oid, o.invoice_no, o.status, oo.delivery_status
                         FROM ${TABLE.DELIVERY_BATCH_ORDER} bo JOIN ${TABLE.ORDERS} o ON o.oid = bo.order_oid JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
                        WHERE bo.batch_oid = $1 AND bo.active AND o.oid = ANY($2) ORDER BY o.created_on, o.oid FOR UPDATE OF o`,
                values: [oid, order_oids],
            });
            if (orders.length !== order_oids.length) fail(400, `Some of those orders are not in ${batch.batch_no}. Reload the batch and tick again.`);
            const delivered = [];
            const left_out = [];
            for (const order of orders) {
                if (order.status !== "Confirmed" || order.delivery_status !== "WithCourier") {
                    left_out.push({ invoice_no: order.invoice_no, status: order.status, delivery_status: order.delivery_status });
                    continue;
                }
                await deliverOrder(tx, { oid: order.oid, batch_no: batch.batch_no, user_id, request });
                delivered.push(order.invoice_no);
            }
            if (!delivered.length) fail(409, "None of the ticked orders is still with the courier. Reload the batch to see what changed.", { left_out });
            const left = left_out.length ? `, ${left_out.length} not with the courier (${left_out.map((order) => order.invoice_no).join(", ")})` : "";
            await saveLogActivity({ reference_type: "delivery-batch", reference_oid: oid, title: "Delivered", description: `${batch.batch_no}: ${delivered.length} delivered${left}` }, { tx, request });
            return { batch_no: batch.batch_no, delivered: delivered.length, left_out };
        });
        log.info(`Delivery batch ${outcome.batch_no}: ${outcome.delivered} delivered, recorded by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Delivered", data: { oid, delivered: outcome.delivered, left_out: outcome.left_out } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while delivering delivery batch ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Nothing was marked delivered. Try again in a moment." });
    }
};

module.exports = deliver_delivery_batch;
