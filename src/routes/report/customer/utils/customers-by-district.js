const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { IN_PERIOD } = require("../../utils/sql");
const { sum } = require("../../utils/run-report");
const { ORDER_MONEY } = require("../../sales/utils/order-money");

// Online sales in the period by the district on each order; a counter sale has no place. A customer who
// bought into two districts counts in each row but once in the total.
const SQL = `
    WITH ${ORDER_MONEY(`${IN_PERIOD("o.sold_on")} AND o.channel = 'ONLINE' AND 'ONLINE' = ANY($3)`)}
    SELECT d.name_en AS district,
           COUNT(DISTINCT f.customer_oid)::int AS customers,
           COALESCE(array_agg(DISTINCT f.customer_oid) FILTER (WHERE f.customer_oid IS NOT NULL), '{}') AS customer_oids,
           COUNT(*) FILTER (WHERE f.kept_units > 0)::int AS sales,
           SUM(f.sales)::float AS sales_value
      FROM figures f
      JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = f.oid
      LEFT JOIN ${TABLE.DISTRICT} d ON d.oid = oo.district_oid
     GROUP BY d.oid, d.name_en
     ORDER BY sales_value DESC, d.name_en NULLS LAST, d.oid
     LIMIT $4`;

const withShare = (rows) => {
    const total = sum(rows, "sales_value");
    return rows.map((row) => ({ ...row, share: total > 0 ? Math.round((row.sales_value / total) * 1000) / 10 : null }));
};

module.exports = {
    title: "Customers by district",
    period: true,
    requires: "sales.online.view",
    columns: [
        { key: "district", label: "District", type: "text" },
        { key: "customers", label: "Customers", type: "int", total: true },
        { key: "sales", label: "Sales", type: "int", total: true },
        { key: "sales_value", label: "Sales value", type: "money", total: true },
        { key: "share", label: "Share", type: "percent" },
    ],
    read: async ({ period, channels, limit }) => withShare(await get_data({ text: SQL, values: [period.date_from, period.date_to, channels, limit] })),
    totals: (rows) => ({ customers: new Set(rows.flatMap((row) => row.customer_oids)).size, sales: sum(rows, "sales"), sales_value: sum(rows, "sales_value") }),
    note: "Online sales only, by the district on each order; counter sales have no place. A customer who bought into two districts counts once in the total.",
};
