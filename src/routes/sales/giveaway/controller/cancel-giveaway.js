const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Only a Draft can be cancelled: nothing has left the shelf yet.
const cancel_giveaway = async (request, res) => {
    const { oid, reason } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const giveaway_no = await execute_transaction(async (tx) => {
            const cancelled = await tx.execute_value({
                text: `UPDATE ${TABLE.GIVEAWAY} SET status = 'Cancelled', cancel_reason = $1, edited_by = $2, edited_on = clock_timestamp()
                        WHERE oid = $3 AND status = 'Draft' RETURNING giveaway_no`,
                values: [reason, user_id, oid],
            });
            if (cancelled.rowCount !== 1) {
                const [row] = await tx.get_data({ text: `SELECT giveaway_no, status FROM ${TABLE.GIVEAWAY} WHERE oid = $1`, values: [oid] });
                if (!row) fail(404, "No giveaway with that number.");
                fail(409, `${row.giveaway_no} is already ${row.status === "Given" ? "given, so its stock has left" : "cancelled"}. Reload it to see what changed.`, { status: row.status });
            }
            const { giveaway_no } = cancelled.rows[0];
            await saveLogActivity({ reference_type: "giveaway", reference_oid: oid, title: "Giveaway cancelled", description: `${giveaway_no} cancelled: ${reason}` }, { tx, request });
            return giveaway_no;
        });
        log.info(`Giveaway ${giveaway_no} cancelled by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Giveaway cancelled", data: { oid, giveaway_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while cancelling a giveaway: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The giveaway was not cancelled. Try again in a moment." });
    }
};

module.exports = cancel_giveaway;
