const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { addOrders, takenElsewhere } = require("../utils/batch-writes");

// While a batch is Open its orders change freely (REQ-04): a parcel pulled at the last minute is taken
// out, and one confirmed since is added.
const update_delivery_batch_orders = async (request, res) => {
    const { oid, order_oids } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const outcome = await execute_transaction(async (tx) => {
            const [batch] = await tx.get_data({ text: `SELECT batch_no, status FROM ${TABLE.DELIVERY_BATCH} WHERE oid = $1 FOR UPDATE`, values: [oid] });
            if (!batch) fail(404, "No delivery batch with that number.");
            if (batch.status !== "Open") fail(409, `${batch.batch_no} is ${batch.status === "HandedOver" ? "already handed to the courier" : "cancelled"}, so its orders stay as they are.`, { status: batch.status });
            const current = (await tx.get_data({ text: `SELECT order_oid FROM ${TABLE.DELIVERY_BATCH_ORDER} WHERE batch_oid = $1 AND active`, values: [oid] })).map((row) => row.order_oid);
            const wanted = new Set(order_oids);
            const removed = current.filter((order_oid) => !wanted.has(order_oid));
            const added = order_oids.filter((order_oid) => !current.includes(order_oid));
            if (!removed.length && !added.length) return { changed: false };
            if (removed.length) {
                await tx.execute_value({ text: `UPDATE ${TABLE.DELIVERY_BATCH_ORDER} SET active = false, edited_by = $1, edited_on = clock_timestamp() WHERE batch_oid = $2 AND order_oid = ANY($3) AND active`, values: [user_id, oid, removed] });
            }
            await addOrders(tx, { batch_oid: oid, order_oids: added, user_id });
            await tx.execute_value({ text: `UPDATE ${TABLE.DELIVERY_BATCH} SET edited_by = $1, edited_on = clock_timestamp() WHERE oid = $2`, values: [user_id, oid] });
            const said = [added.length && `${added.length} added`, removed.length && `${removed.length} taken out`].filter(Boolean).join(", ");
            await saveLogActivity({ reference_type: "delivery-batch", reference_oid: oid, title: "Orders changed", description: `${batch.batch_no}: ${said}, ${order_oids.length} in the batch` }, { tx, request });
            return { changed: true };
        });
        return res.status(200).json({ code: 200, message: outcome.changed ? "Orders changed" : "Nothing changed.", data: { oid, changed: outcome.changed } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        if (takenElsewhere(e)) return res.status(409).json({ code: 409, message: "One of these orders was just put in another batch. Reload the orders and try again." });
        log.error(`An exception occurred while changing the orders of delivery batch ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The batch's orders were not changed. Try again in a moment." });
    }
};

module.exports = update_delivery_batch_orders;
