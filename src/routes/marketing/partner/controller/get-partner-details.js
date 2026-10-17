const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { getLogActivities } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { permissions_for } = require("../../../../middleware/require-permission");
const { business_today } = require("../../../../utils/business-time");

const get_partner_details = async (request, res) => {
    const { oid } = request.params;
    try {
        const [details] = await get_data({
            text: `SELECT oid, name, partner_type, platforms, handle, phone_number, payment_method, payment_account, note, status,
                          created_by, created_on, edited_by, edited_on, COALESCE(edited_on, created_on) AS last_action_on
                     FROM ${TABLE.PARTNER} WHERE oid = $1`,
            values: [oid],
        });
        if (!details) return res.status(404).json({ code: 404, message: "No partner with that id. It may have been removed.", data: null });

        const [activity, held] = await Promise.all([getLogActivities("partner", oid, 5), permissions_for(request.credentials.user_id)]);
        // The campaigns they are on for whoever may see campaigns; paid and owed only with the payments permission.
        let campaigns = null;
        if (held.has("marketing.campaign.view")) {
            const rows = await get_data({
                text: `SELECT c.oid, c.campaign_no, c.name, c.status, to_char(c.posting_start, 'YYYY-MM-DD') AS posting_start, cp.agreed_fee,
                              (SELECT COUNT(*)::int FROM ${TABLE.CAMPAIGN_DELIVERABLE} d WHERE d.campaign_partner_oid = cp.oid AND d.status = 'Pending' AND d.due_on < ${business_today}) AS past_due,
                              (SELECT COALESCE(SUM(pp.amount), 0)::bigint FROM ${TABLE.PARTNER_PAYMENT} pp WHERE pp.campaign_partner_oid = cp.oid) AS paid
                         FROM ${TABLE.CAMPAIGN_PARTNER} cp JOIN ${TABLE.CAMPAIGN} c ON c.oid = cp.campaign_oid
                        WHERE cp.partner_oid = $1
                        ORDER BY c.posting_start DESC, c.oid`,
                values: [oid],
            });
            const payments = held.has("marketing.partner-payment.view");
            campaigns = rows.map(({ paid, ...row }) => (payments ? { ...row, paid: Number(paid), owed: Math.max(Number(row.agreed_fee) - Number(paid), 0) } : row));
        }
        return res.status(200).json({
            code: 200,
            message: "Partner",
            data: { details, campaigns, activity: activity.map((a) => ({ oid: a.oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description })) },
        });
    } catch (e) {
        log.error(`An exception occurred while loading partner ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the partner. Try again in a moment." });
    }
};

module.exports = get_partner_details;
