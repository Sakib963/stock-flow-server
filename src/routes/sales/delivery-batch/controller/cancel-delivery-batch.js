const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Cancel (REQ-10): only an Open batch, whose orders are freed for another. A handed over batch is
// never cancelled: its stock has moved, and each order's own actions correct it.
const cancel_delivery_batch = async (request, res) => {
    const { oid, note } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const batch_no = await execute_transaction(async (tx) => {
            const cancelled = await tx.execute_value({
                text: `UPDATE ${TABLE.DELIVERY_BATCH} SET status = 'Cancelled', cancelled_on = clock_timestamp(), cancelled_by = $1, cancel_note = $2, edited_by = $1, edited_on = clock_timestamp()
                        WHERE oid = $3 AND status = 'Open' RETURNING batch_no`,
                values: [user_id, note, oid],
            });
            if (cancelled.rowCount !== 1) {
                const [batch] = await tx.get_data({ text: `SELECT batch_no, status FROM ${TABLE.DELIVERY_BATCH} WHERE oid = $1`, values: [oid] });
                if (!batch) fail(404, "No delivery batch with that number.");
                fail(409, `${batch.batch_no} is ${batch.status === "HandedOver" ? "already handed to the courier, so it cannot be cancelled. Correct each order on its own record" : "already cancelled"}.`, { status: batch.status });
            }
            const { batch_no } = cancelled.rows[0];
            const freed = await tx.execute_value({ text: `UPDATE ${TABLE.DELIVERY_BATCH_ORDER} SET active = false, edited_by = $1, edited_on = clock_timestamp() WHERE batch_oid = $2 AND active`, values: [user_id, oid] });
            await saveLogActivity({ reference_type: "delivery-batch", reference_oid: oid, title: "Batch cancelled", description: `${batch_no}: ${freed.rowCount} order${freed.rowCount === 1 ? "" : "s"} freed. ${note}` }, { tx, request });
            return batch_no;
        });
        log.info(`Delivery batch ${batch_no} cancelled by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Batch cancelled", data: { oid, batch_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while cancelling delivery batch ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The batch was not cancelled. Try again in a moment." });
    }
};

module.exports = cancel_delivery_batch;
