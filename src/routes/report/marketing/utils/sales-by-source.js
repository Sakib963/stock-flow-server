const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { IN_PERIOD } = require("../../utils/sql");
const { sum } = require("../../utils/run-report");
const { ORDER_MONEY } = require("../../sales/utils/order-money");

// Kept sales in the period by the source on the order, a No source row keeping the online rows equal to
// the register's, and the counter as one row. A new customer is credited to the source of their first
// kept sale, as marketing analytics does, never to the customer's first source field.
const SQL = `
    WITH ${ORDER_MONEY(`${IN_PERIOD("o.sold_on")} AND o.channel = ANY($3)`)},
    firsts AS (
        SELECT DISTINCT ON (o.customer_oid) o.customer_oid, o.oid
          FROM ${TABLE.ORDERS} o
         WHERE o.customer_oid IS NOT NULL AND o.sold_on IS NOT NULL AND o.status <> 'Returned' AND o.channel = ANY($3)
         ORDER BY o.customer_oid, o.sold_on, o.oid
    )
    SELECT CASE WHEN f.channel = 'POS' THEN 'counter' WHEN s.oid IS NULL THEN 'no_source' ELSE 'source' END AS kind, s.name AS source, s.platform,
           COUNT(*) FILTER (WHERE f.kept_units > 0)::int AS sales,
           SUM(f.sales)::float AS sales_value,
           COUNT(fs.oid)::int AS new_customers
      FROM figures f
      LEFT JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = f.oid
      LEFT JOIN ${TABLE.ORDER_SOURCE} s ON s.oid = oo.source_oid
      LEFT JOIN firsts fs ON fs.oid = f.oid
     GROUP BY 1, s.oid, s.name, s.platform
     ORDER BY sales_value DESC, s.name NULLS LAST, s.oid
     LIMIT $4`;

module.exports = {
    title: "Sales by source",
    period: true,
    columns: [
        { key: "source", label: "Source", type: "text" },
        { key: "platform", label: "Platform", type: "text" },
        { key: "sales", label: "Sales", type: "int", total: true },
        { key: "sales_value", label: "Sales value", type: "money", total: true },
        { key: "share", label: "Share", type: "percent" },
        { key: "new_customers", label: "New customers", type: "int", total: true },
    ],
    read: async ({ period, channels, limit }) => {
        const rows = await get_data({ text: SQL, values: [period.date_from, period.date_to, channels, limit] });
        const total = sum(rows, "sales_value");
        return rows.map((row) => ({ ...row, source: row.kind === "source" ? row.source : row.kind === "counter" ? "Counter" : "No source", share: total > 0 ? Math.round((row.sales_value / total) * 1000) / 10 : null }));
    },
    note: "Dated by the sale, so it can differ from marketing analytics, which counts orders placed. A new customer is credited to the source of their first kept sale.",
};
