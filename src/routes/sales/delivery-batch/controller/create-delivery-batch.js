const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { business_number } = require("../../../../utils/business-time");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { addOrders, takenElsewhere } = require("../utils/batch-writes");

const create_delivery_batch = async (request, res) => {
    const { oid, courier, note, order_oids } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const outcome = await execute_transaction(async (tx) => {
            const saved = await tx.execute_value({
                text: `INSERT INTO ${TABLE.DELIVERY_BATCH} (oid, batch_no, courier, status, note, created_by)
                       VALUES ($1, ${business_number("DB", "delivery_batch_number_seq")}, $2, 'Open', $3, $4)
                       ON CONFLICT (oid) DO NOTHING RETURNING batch_no`,
                values: [oid, courier, note, user_id],
            });
            if (saved.rowCount !== 1) {
                const [already] = await tx.get_data({ text: `SELECT batch_no, created_by FROM ${TABLE.DELIVERY_BATCH} WHERE oid = $1`, values: [oid] });
                if (already?.created_by !== user_id) fail(409, "That batch number is already taken. Reload the page and try again.");
                return { batch_no: already.batch_no, repeated: true };
            }
            const { batch_no } = saved.rows[0];
            await addOrders(tx, { batch_oid: oid, order_oids, user_id });
            await saveLogActivity({ reference_type: "delivery-batch", reference_oid: oid, title: "Batch made", description: `${batch_no}: ${courier}, ${order_oids.length} order${order_oids.length === 1 ? "" : "s"}` }, { tx, request });
            return { batch_no, repeated: false };
        });
        if (!outcome.repeated) log.info(`Delivery batch ${outcome.batch_no} made by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Batch made", data: { oid, batch_no: outcome.batch_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        if (takenElsewhere(e)) return res.status(409).json({ code: 409, message: "One of these orders was just put in another batch. Reload the orders and try again." });
        log.error(`An exception occurred while making a delivery batch: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The batch was not made. Try again in a moment." });
    }
};

module.exports = create_delivery_batch;
