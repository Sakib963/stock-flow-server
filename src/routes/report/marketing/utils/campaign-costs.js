const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day_start } = require("../../../../utils/business-time");
const { sum } = require("../../utils/run-report");

// Campaigns whose posting starts in the period. A cancelled campaign cost what was actually paid to its
// partners; the others cost the agreed fees, as the campaign list says. Gifts count once Given.
const SQL = `
    SELECT c.campaign_no, c.name AS campaign, c.status AS campaign_status, to_char(c.posting_start, 'YYYY-MM-DD') AS day,
           (CASE WHEN c.status = 'Cancelled'
                 THEN (SELECT COALESCE(SUM(pp.amount), 0) FROM ${TABLE.PARTNER_PAYMENT} pp JOIN ${TABLE.CAMPAIGN_PARTNER} cp ON cp.oid = pp.campaign_partner_oid WHERE cp.campaign_oid = c.oid)
                 ELSE (SELECT COALESCE(SUM(cp.agreed_fee), 0) FROM ${TABLE.CAMPAIGN_PARTNER} cp WHERE cp.campaign_oid = c.oid) END)::float AS partner_fees,
           COALESCE(c.ad_spend, 0)::float AS ad_spend, COALESCE(c.other_cost, 0)::float AS other_cost,
           (SELECT COALESCE(SUM(gl.quantity * gl.cost_price), 0) FROM ${TABLE.GIVEAWAY} g JOIN ${TABLE.GIVEAWAY_LINE} gl ON gl.giveaway_oid = g.oid JOIN ${TABLE.CAMPAIGN_PARTNER} cp ON cp.oid = g.campaign_partner_oid WHERE cp.campaign_oid = c.oid AND g.status = 'Given')::float AS gift_cost
      FROM ${TABLE.CAMPAIGN} c
     WHERE c.posting_start >= $1::date AND c.posting_start <= $2::date AND ($3::text IS NULL OR c.status = $3)
     ORDER BY c.posting_start, c.campaign_no, c.oid
     LIMIT $4`;

module.exports = {
    title: "Campaign costs",
    period: true,
    columns: [
        { key: "day", label: "Posting starts", type: "day" },
        { key: "campaign_no", label: "Campaign", type: "code" },
        { key: "campaign", label: "Name", type: "text" },
        { key: "campaign_status", label: "Status", type: "campaign_status" },
        { key: "partner_fees", label: "Partner fees", type: "money", total: true },
        { key: "ad_spend", label: "Ad spend", type: "money", total: true },
        { key: "other_cost", label: "Other cost", type: "money", total: true },
        { key: "gift_cost", label: "Products given", type: "money", total: true, cost: true },
        { key: "total_cost", label: "Total", type: "money", total: true },
    ],
    cost_totals: [],
    read: async ({ query, period, limit }) =>
        (await get_data({ text: SQL, values: [period.date_from, period.date_to, query.status ?? null, limit] })).map((row) => ({ ...row, total_cost: row.partner_fees + row.ad_spend + row.other_cost + row.gift_cost })),
    totals: (rows) => Object.fromEntries(["partner_fees", "ad_spend", "other_cost", "gift_cost", "total_cost"].map((key) => [key, sum(rows, key)])),
    note: "By the day posting starts. A cancelled campaign counts what was paid to its partners, the others the agreed fees. Products given are at cost and count once given.",
};
