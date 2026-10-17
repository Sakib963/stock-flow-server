const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { lock_line } = require("../utils/deliverable-line");

// Only a promise still Pending can go, as one entered by mistake; one with an outcome is a record.
const delete_campaign_deliverable = async (request, res) => {
    const { oid } = request.body;
    const user_id = request.credentials.user_id;
    try {
        await execute_transaction(async (tx) => {
            const line = await lock_line(tx, { deliverable_oid: oid });
            const [row] = await tx.get_data({ text: `DELETE FROM ${TABLE.CAMPAIGN_DELIVERABLE} WHERE oid = $1 AND status = 'Pending' RETURNING kind, quantity`, values: [oid] });
            if (!row) fail(409, "Only a promised post still pending can be removed. Mark this one Missed instead.");
            await saveLogActivity({ reference_type: "campaign", reference_oid: line.campaign_oid, title: "Promised post removed", description: `${line.campaign_no}: ${row.quantity} ${row.kind} from ${line.name}` }, { tx, request });
        });
        log.info(`Promised post ${oid} removed by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Promised post removed", data: { oid } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while removing promised post ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not remove the promised post. Try again in a moment." });
    }
};

module.exports = delete_campaign_deliverable;
