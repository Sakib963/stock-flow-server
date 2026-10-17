const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { business_number } = require("../../../../utils/business-time");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { save_batches, save_partners } = require("../utils/campaign-lines");

const create_campaign = async (request, res) => {
    const c = request.body;
    const user_id = request.credentials.user_id;
    try {
        const outcome = await execute_transaction(async (tx) => {
            const saved = await tx.execute_value({
                text: `INSERT INTO ${TABLE.CAMPAIGN} (oid, campaign_no, name, promotion_type, status, posting_start, posting_end, measure_end, ad_spend, other_cost, other_cost_note, note, created_by)
                       VALUES ($1, ${business_number("CM", "campaign_number_seq")}, $2, $3, 'Planned', $4, $5, COALESCE($6::date, $5::date + 3), $7, $8, $9, $10, $11)
                       ON CONFLICT (oid) DO NOTHING RETURNING campaign_no`,
                values: [c.oid, c.name, c.promotion_type, c.posting_start, c.posting_end, c.measure_end, c.ad_spend, c.other_cost, c.other_cost_note, c.note, user_id],
            });
            if (saved.rowCount !== 1) {
                const [already] = await tx.get_data({ text: `SELECT campaign_no, created_by FROM ${TABLE.CAMPAIGN} WHERE oid = $1`, values: [c.oid] });
                if (already?.created_by !== user_id) fail(409, "That campaign number is already taken. Reload the page and try again.");
                return { campaign_no: already.campaign_no, repeated: true };
            }
            const { campaign_no } = saved.rows[0];
            await save_batches(tx, { campaign_oid: c.oid, batches: c.batches, user_id });
            await save_partners(tx, { campaign_oid: c.oid, partners: c.partners, user_id });
            await saveLogActivity({ reference_type: "campaign", reference_oid: c.oid, title: "Campaign planned", description: `${campaign_no}: ${c.name}, ${c.batches.length} batch${c.batches.length === 1 ? "" : "es"}, ${c.partners.length} partner${c.partners.length === 1 ? "" : "s"}` }, { tx, request });
            return { campaign_no, repeated: false };
        });
        if (!outcome.repeated) log.info(`Campaign ${outcome.campaign_no} planned by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Campaign planned", data: { oid: c.oid, campaign_no: outcome.campaign_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while planning a campaign: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the campaign. Try again in a moment." });
    }
};

module.exports = create_campaign;
