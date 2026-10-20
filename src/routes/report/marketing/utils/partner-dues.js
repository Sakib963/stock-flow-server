const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");

// What each partner is still owed on a campaign that is not cancelled: a cancelled one takes no more
// payments, so its rest is not owed.
const SQL = `
    WITH lines AS (
        SELECT p.name AS partner, c.campaign_no, c.name AS campaign, c.status AS campaign_status, cp.agreed_fee,
               (SELECT COALESCE(SUM(pp.amount), 0) FROM ${TABLE.PARTNER_PAYMENT} pp WHERE pp.campaign_partner_oid = cp.oid) AS paid, cp.oid
          FROM ${TABLE.CAMPAIGN_PARTNER} cp
          JOIN ${TABLE.PARTNER} p ON p.oid = cp.partner_oid
          JOIN ${TABLE.CAMPAIGN} c ON c.oid = cp.campaign_oid
         WHERE c.status <> 'Cancelled'
    )
    SELECT partner, campaign_no, campaign, campaign_status, agreed_fee::float AS agreed_fee, paid::float AS paid, (agreed_fee - paid)::float AS owed
      FROM lines
     WHERE agreed_fee > paid
     ORDER BY partner, campaign_no, oid
     LIMIT $1`;

module.exports = {
    title: "Partner dues",
    period: false,
    requires: "marketing.partner-payment.view",
    columns: [
        { key: "partner", label: "Partner", type: "text" },
        { key: "campaign_no", label: "Campaign", type: "code" },
        { key: "campaign", label: "Name", type: "text" },
        { key: "campaign_status", label: "Status", type: "campaign_status" },
        { key: "agreed_fee", label: "Agreed fee", type: "money", total: true },
        { key: "paid", label: "Paid", type: "money", total: true },
        { key: "owed", label: "Owed", type: "money", total: true },
    ],
    read: ({ limit }) => get_data({ text: SQL, values: [limit] }),
    note: "As at now, campaigns not cancelled.",
};
