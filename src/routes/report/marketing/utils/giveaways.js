const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day } = require("../../../../utils/business-time");
const { IN_PERIOD } = require("../../utils/sql");

// Gifts given in the period, by the day given. A gift that came back with a refused parcel is Returned
// and leaves the month it was given, as a return leaves the month of its sale.
const SQL = `
    SELECT to_char(${business_day("g.given_on")}, 'YYYY-MM-DD') AS day, g.giveaway_no, g.recipient_name AS recipient, c.campaign_no,
           pr.name AS product, gl.quantity::int AS quantity, (gl.quantity * gl.cost_price)::float AS cost
      FROM ${TABLE.GIVEAWAY} g
      JOIN ${TABLE.GIVEAWAY_LINE} gl ON gl.giveaway_oid = g.oid
      JOIN ${TABLE.PRODUCT} pr ON pr.oid = gl.product_oid
      LEFT JOIN ${TABLE.CAMPAIGN_PARTNER} cp ON cp.oid = g.campaign_partner_oid
      LEFT JOIN ${TABLE.CAMPAIGN} c ON c.oid = cp.campaign_oid
     WHERE g.status = 'Given' AND ${IN_PERIOD("g.given_on")}
     ORDER BY g.given_on, g.giveaway_no, gl.oid
     LIMIT $3`;

module.exports = {
    title: "Giveaways",
    period: true,
    columns: [
        { key: "day", label: "Given", type: "day" },
        { key: "giveaway_no", label: "Giveaway", type: "code" },
        { key: "recipient", label: "Recipient", type: "text" },
        { key: "campaign_no", label: "Campaign", type: "code" },
        { key: "product", label: "Product", type: "text" },
        { key: "quantity", label: "Quantity", type: "int", total: true },
        { key: "cost", label: "Cost", type: "money", total: true, cost: true },
    ],
    read: ({ period, limit }) => get_data({ text: SQL, values: [period.date_from, period.date_to, limit] }),
    note: "By the day given. A gift that came back with a refused parcel is not counted. Cost is the batch's cost.",
};
