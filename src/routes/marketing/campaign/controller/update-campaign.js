const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { refuse_stale } = require("../../../../db/stale-edit");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { save_batches, save_partners } = require("../utils/campaign-lines");

// Completed and Cancelled campaigns are a record; only a Planned or Live one changes.
const update_campaign = async (request, res) => {
    const c = request.body;
    const user_id = request.credentials.user_id;
    try {
        const campaign_no = await execute_transaction(async (tx) => {
            await refuse_stale(tx, { table: TABLE.CAMPAIGN, oid: c.oid, version: c.version, gone: "That campaign no longer exists. It may have been removed." });
            const [row] = await tx.get_data({ text: `SELECT campaign_no, status FROM ${TABLE.CAMPAIGN} WHERE oid = $1 FOR UPDATE`, values: [c.oid] });
            if (!row) fail(404, "That campaign no longer exists. It may have been removed.");
            if (!["Planned", "Live"].includes(row.status)) fail(409, `A ${row.status.toLowerCase()} campaign can no longer be changed.`, { status: row.status });

            await tx.execute_value({
                text: `UPDATE ${TABLE.CAMPAIGN}
                          SET name = $1, promotion_type = $2, posting_start = $3, posting_end = $4, measure_end = COALESCE($5::date, $4::date + 3),
                              ad_spend = $6, other_cost = $7, other_cost_note = $8, note = $9, edited_by = $10, edited_on = clock_timestamp()
                        WHERE oid = $11`,
                values: [c.name, c.promotion_type, c.posting_start, c.posting_end, c.measure_end, c.ad_spend, c.other_cost, c.other_cost_note, c.note, user_id, c.oid],
            });
            await save_batches(tx, { campaign_oid: c.oid, batches: c.batches, user_id });
            const { added, removed } = await save_partners(tx, { campaign_oid: c.oid, partners: c.partners, user_id });
            const who = [added.length ? `added ${added.join(", ")}` : "", removed.length ? `took off ${removed.join(", ")}` : ""].filter(Boolean).join("; ");
            await saveLogActivity({ reference_type: "campaign", reference_oid: c.oid, title: "Campaign changed", description: `${row.campaign_no}: ${c.name}${who ? `; ${who}` : ""}` }, { tx, request });
            return row.campaign_no;
        });
        log.info(`Campaign ${campaign_no} changed by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Campaign saved", data: { oid: c.oid } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while changing campaign ${c.oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the campaign. Try again in a moment." });
    }
};

module.exports = update_campaign;
