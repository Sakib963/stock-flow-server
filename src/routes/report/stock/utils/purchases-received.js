const { get_data } = require("../../../../db/database");
const { business_day } = require("../../../../utils/business-time");
const { IN_PERIOD } = require("../../utils/sql");
const { PURCHASE_MONEY } = require("./purchase-money");

const SQL = `
    WITH received AS (${PURCHASE_MONEY(`${IN_PERIOD("pu.verified_on")} AND ($3::text IS NULL OR pu.supplier_oid = $3)`)})
    SELECT to_char(${business_day("verified_on")}, 'YYYY-MM-DD') AS day, po_number, supplier, units::int AS units_received,
           total::float, paid::float, GREATEST(total - paid, 0)::float AS owed, payment_status
      FROM received
     ORDER BY verified_on, po_number
     LIMIT $4`;

module.exports = {
    title: "Purchases received",
    period: true,
    columns: [
        { key: "day", label: "Received", type: "day" },
        { key: "po_number", label: "Purchase order", type: "code" },
        { key: "supplier", label: "Supplier", type: "text" },
        { key: "units_received", label: "Units received", type: "int", total: true },
        { key: "total", label: "Total", type: "money", total: true, cost: true },
        { key: "paid", label: "Paid", type: "money", total: true, cost: true },
        { key: "owed", label: "Owed", type: "money", total: true, cost: true },
        { key: "payment_status", label: "Payment status", type: "purchase_payment", cost: true },
    ],
    read: ({ query, period, limit }) => get_data({ text: SQL, values: [period.date_from, period.date_to, query.supplier_oid ?? null, limit] }),
    note: "Dated when the goods were received. Money is on the total recorded on the order; paid is as at now.",
};
