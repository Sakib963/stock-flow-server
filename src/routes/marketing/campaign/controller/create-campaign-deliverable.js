const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { POSTED_ON, lock_line } = require("../utils/deliverable-line");

// The oid is made by the client, so a save repeated after a lost answer records the promise once.
const create_campaign_deliverable = async (request, res) => {
    const d = request.body;
    const user_id = request.credentials.user_id;
    try {
        await execute_transaction(async (tx) => {
            const line = await lock_line(tx, { campaign_partner_oid: d.campaign_partner_oid });
            const saved = await tx.execute_value({
                text: `INSERT INTO ${TABLE.CAMPAIGN_DELIVERABLE} (oid, campaign_partner_oid, kind, quantity, due_on, status, link, posted_on, note, created_by)
                       VALUES ($1, $2, $3, $4, $5, $6::text, $7, ${POSTED_ON("$6::text", "$8")}, $9, $10) ON CONFLICT (oid) DO NOTHING`,
                values: [d.oid, line.oid, d.kind, d.quantity, d.due_on, d.status, d.link, d.posted_on, d.note, user_id],
            });
            if (saved.rowCount === 1) {
                await saveLogActivity({ reference_type: "campaign", reference_oid: line.campaign_oid, title: "Promised post added", description: `${line.campaign_no}: ${d.quantity} ${d.kind} from ${line.name}, due ${d.due_on}` }, { tx, request });
            }
        });
        return res.status(200).json({ code: 200, message: "Promised post added", data: { oid: d.oid } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while adding a promised post: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the promised post. Try again in a moment." });
    }
};

module.exports = create_campaign_deliverable;
