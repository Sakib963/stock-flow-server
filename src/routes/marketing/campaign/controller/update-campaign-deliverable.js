const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { POSTED_ON, lock_line } = require("../utils/deliverable-line");

// The person sets the status: nothing marks a promise Late or Missed by itself (the user, 2026-10-17).
const update_campaign_deliverable = async (request, res) => {
    const d = request.body;
    const user_id = request.credentials.user_id;
    try {
        await execute_transaction(async (tx) => {
            const line = await lock_line(tx, { deliverable_oid: d.oid });
            const updated = await tx.execute_value({
                text: `UPDATE ${TABLE.CAMPAIGN_DELIVERABLE}
                          SET kind = $1, quantity = $2, due_on = $3, status = $4::text, link = $5, posted_on = ${POSTED_ON("$4::text", "$6")}, note = $7, edited_by = $8, edited_on = clock_timestamp()
                        WHERE oid = $9`,
                values: [d.kind, d.quantity, d.due_on, d.status, d.link, d.posted_on, d.note, user_id, d.oid],
            });
            if (updated.rowCount !== 1) fail(404, "That promised post no longer exists. Reload the campaign.");
            await saveLogActivity({ reference_type: "campaign", reference_oid: line.campaign_oid, title: "Promised post updated", description: `${line.campaign_no}: ${d.quantity} ${d.kind} from ${line.name}, ${d.status}` }, { tx, request });
        });
        return res.status(200).json({ code: 200, message: "Promised post saved", data: { oid: d.oid } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while updating promised post ${d.oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the promised post. Try again in a moment." });
    }
};

module.exports = update_campaign_deliverable;
