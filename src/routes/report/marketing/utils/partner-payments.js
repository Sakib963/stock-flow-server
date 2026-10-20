const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");

const SQL = `
    SELECT to_char(pp.paid_on, 'YYYY-MM-DD') AS day, p.name AS partner, c.campaign_no, c.name AS campaign, pp.amount::float AS amount, pp.payment_method, pp.reference
      FROM ${TABLE.PARTNER_PAYMENT} pp
      JOIN ${TABLE.CAMPAIGN_PARTNER} cp ON cp.oid = pp.campaign_partner_oid
      JOIN ${TABLE.PARTNER} p ON p.oid = cp.partner_oid
      JOIN ${TABLE.CAMPAIGN} c ON c.oid = cp.campaign_oid
     WHERE pp.paid_on >= $1::date AND pp.paid_on <= $2::date
     ORDER BY pp.paid_on, p.name, pp.oid
     LIMIT $3`;

module.exports = {
    title: "Partner payments",
    period: true,
    requires: "marketing.partner-payment.view",
    columns: [
        { key: "day", label: "Paid on", type: "day" },
        { key: "partner", label: "Partner", type: "text" },
        { key: "campaign_no", label: "Campaign", type: "code" },
        { key: "campaign", label: "Name", type: "text" },
        { key: "amount", label: "Amount", type: "money", total: true },
        { key: "payment_method", label: "Paid by", type: "text" },
        { key: "reference", label: "Reference", type: "code" },
    ],
    read: ({ period, limit }) => get_data({ text: SQL, values: [period.date_from, period.date_to, limit] }),
    note: "Every payment to a partner recorded in the period.",
};
