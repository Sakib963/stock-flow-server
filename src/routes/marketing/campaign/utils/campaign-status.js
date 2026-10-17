const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Each status change a person presses (REQ-04): where it may start, where it goes, and who and when it records.
const MOVES = {
    start: { from: ["Planned"], to: "Live", stamp: "started", title: "Campaign started" },
    complete: { from: ["Live"], to: "Completed", stamp: "completed", title: "Campaign completed" },
    cancel: { from: ["Planned", "Live"], to: "Cancelled", stamp: "cancelled", title: "Campaign cancelled" },
};

/** A controller for one move, guarded in SQL on the status it starts from. */
const status_change = (move) => async (request, res) => {
    const { oid, note = null } = request.body;
    const { from, to, stamp, title } = MOVES[move];
    const user_id = request.credentials.user_id;
    try {
        const campaign_no = await execute_transaction(async (tx) => {
            const [row] = await tx.get_data({ text: `SELECT campaign_no, status FROM ${TABLE.CAMPAIGN} WHERE oid = $1 FOR UPDATE`, values: [oid] });
            if (!row) fail(404, "That campaign no longer exists. It may have been removed.");
            if (!from.includes(row.status)) fail(409, `This campaign is ${row.status.toLowerCase()} now, so it cannot be ${stamp}. Reload it to see where it is.`, { status: row.status });

            const updated = await tx.execute_value({
                text: `UPDATE ${TABLE.CAMPAIGN}
                          SET status = $1, ${stamp}_on = clock_timestamp(), ${stamp}_by = $2, cancel_note = COALESCE($3, cancel_note), edited_by = $2, edited_on = clock_timestamp()
                        WHERE oid = $4 AND status = ANY($5)`,
                values: [to, user_id, note, oid, from],
            });
            if (updated.rowCount !== 1) fail(409, "This campaign changed while it was being saved. Reload it and try again.");
            await saveLogActivity({ reference_type: "campaign", reference_oid: oid, title, description: note ? `${row.campaign_no}: ${note}` : row.campaign_no }, { tx, request });
            return row.campaign_no;
        });
        log.info(`Campaign ${campaign_no} ${to} by ${user_id}`);
        return res.status(200).json({ code: 200, message: title, data: { oid, status: to } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while moving campaign ${oid} to ${to}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not change the campaign. Try again in a moment." });
    }
};

module.exports = { status_change };
