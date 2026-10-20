const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { IN_PERIOD } = require("../../utils/sql");
const { sum } = require("../../utils/run-report");
const { ORDER_MONEY } = require("../../sales/utils/order-money");

// Sales in the period by the buyer's age band and gender. A walk-in sale with no customer is its own row,
// apart from Not given, so the shares add up to the period's sales.
const SQL = `
    WITH ${ORDER_MONEY(`${IN_PERIOD("o.sold_on")} AND o.channel = ANY($3)`)}
    SELECT CASE WHEN f.customer_oid IS NULL THEN 'no_customer' ELSE COALESCE(c.age_band, 'not_given') END AS age_band,
           CASE WHEN f.customer_oid IS NULL THEN 'no_customer' ELSE COALESCE(c.gender, 'not_given') END AS gender,
           COUNT(DISTINCT f.customer_oid)::int AS customers,
           COUNT(*) FILTER (WHERE f.kept_units > 0)::int AS sales,
           SUM(f.sales)::float AS sales_value
      FROM figures f
      LEFT JOIN ${TABLE.CUSTOMERS} c ON c.oid = f.customer_oid
     GROUP BY 1, 2
     ORDER BY 1, 2
     LIMIT $4`;

module.exports = {
    title: "Customers by age and gender",
    period: true,
    columns: [
        { key: "age_band", label: "Age", type: "age_band" },
        { key: "gender", label: "Gender", type: "gender" },
        { key: "customers", label: "Customers", type: "int", total: true },
        { key: "sales", label: "Sales", type: "int", total: true },
        { key: "sales_value", label: "Sales value", type: "money", total: true },
        { key: "share", label: "Share", type: "percent" },
    ],
    read: async ({ period, channels, limit }) => {
        const rows = await get_data({ text: SQL, values: [period.date_from, period.date_to, channels, limit] });
        const total = sum(rows, "sales_value");
        return rows.map((row) => ({ ...row, share: total > 0 ? Math.round((row.sales_value / total) * 1000) / 10 : null }));
    },
    note: "Age and gender are as recorded on the customer. Walk-in sales with no customer are their own row.",
};
