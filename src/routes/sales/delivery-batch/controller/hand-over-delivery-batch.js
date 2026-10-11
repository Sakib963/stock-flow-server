const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { dispatchOrder } = require("../../utils/order-moves");
const { READY } = require("../utils/batch-orders");

// Handed to courier (REQ-08): the rider has the parcels, so each order still ready is dispatched as it
// would be on its own record, deducting its held stock. One no longer ready (cancelled, or dispatched
// on its record meanwhile) is left out, freed from the batch and named; the rest still go.
const hand_over_delivery_batch = async (request, res) => {
    const { oid } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const outcome = await execute_transaction(async (tx) => {
            const moved = await tx.execute_value({
                text: `UPDATE ${TABLE.DELIVERY_BATCH} SET status = 'HandedOver', handed_over_on = clock_timestamp(), handed_over_by = $1, edited_by = $1, edited_on = clock_timestamp()
                        WHERE oid = $2 AND status = 'Open' RETURNING batch_no, courier`,
                values: [user_id, oid],
            });
            if (moved.rowCount !== 1) {
                const [batch] = await tx.get_data({ text: `SELECT batch_no, status FROM ${TABLE.DELIVERY_BATCH} WHERE oid = $1`, values: [oid] });
                if (!batch) fail(404, "No delivery batch with that number.");
                fail(409, `${batch.batch_no} is ${batch.status === "HandedOver" ? "already handed to the courier" : "cancelled"}. Reload the batch to see what changed.`, { status: batch.status });
            }
            const { batch_no, courier } = moved.rows[0];
            const orders = await tx.get_data({
                text: `SELECT o.oid, o.invoice_no, o.status, oo.delivery_status, ${READY} AS ready
                         FROM ${TABLE.DELIVERY_BATCH_ORDER} bo JOIN ${TABLE.ORDERS} o ON o.oid = bo.order_oid JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
                        WHERE bo.batch_oid = $1 AND bo.active ORDER BY o.created_on, o.oid FOR UPDATE OF o`,
                values: [oid],
            });
            const dispatched = [];
            const left_out = [];
            for (const order of orders) {
                if (!order.ready) {
                    left_out.push({ invoice_no: order.invoice_no, status: order.status, delivery_status: order.delivery_status });
                    continue;
                }
                await dispatchOrder(tx, { oid: order.oid, courier, batch_no, user_id, request });
                dispatched.push(order.invoice_no);
            }
            if (!dispatched.length) fail(409, `None of the orders in ${batch_no} can be dispatched now. Take them out or cancel the batch.`, { left_out });
            if (left_out.length) {
                await tx.execute_value({
                    text: `UPDATE ${TABLE.DELIVERY_BATCH_ORDER} bo SET active = false, edited_by = $1, edited_on = clock_timestamp() FROM ${TABLE.ORDERS} o
                            WHERE bo.batch_oid = $2 AND bo.active AND o.oid = bo.order_oid AND o.invoice_no = ANY($3)`,
                    values: [user_id, oid, left_out.map((order) => order.invoice_no)],
                });
            }
            const left = left_out.length ? `, ${left_out.length} left out (${left_out.map((order) => order.invoice_no).join(", ")})` : "";
            await saveLogActivity({ reference_type: "delivery-batch", reference_oid: oid, title: "Handed to courier", description: `${batch_no}: ${dispatched.length} dispatched with ${courier}${left}` }, { tx, request });
            return { batch_no, dispatched: dispatched.length, left_out };
        });
        log.info(`Delivery batch ${outcome.batch_no} handed over by ${user_id}: ${outcome.dispatched} dispatched, ${outcome.left_out.length} left out`);
        return res.status(200).json({ code: 200, message: "Handed to courier", data: { oid, dispatched: outcome.dispatched, left_out: outcome.left_out } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while handing over delivery batch ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Nothing was dispatched. Try again in a moment." });
    }
};

module.exports = hand_over_delivery_batch;
