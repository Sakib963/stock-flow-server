const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { IN_PERIOD } = require("../../utils/sql");
const { sum } = require("../../utils/run-report");

// The lines of Sales by product added up by category, a product with no category kept as its own row
// so the totals of the two reports agree.
const SQL = `
    SELECT c.name AS category,
           SUM(oi.quantity - oi.returned_qty)::int AS units_kept,
           SUM((oi.unit_price - COALESCE(oi.discount, 0)) * (oi.quantity - oi.returned_qty))::float AS sales,
           SUM(COALESCE(i.cost_price, 0) * (oi.quantity - oi.returned_qty))::float AS cost,
           COALESCE(SUM(oi.quantity - oi.returned_qty) FILTER (WHERE i.cost_price IS NULL), 0)::int AS units_without_cost
      FROM ${TABLE.ORDERS} o
      JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
      JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid
      LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
      LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = oi.inventory_oid
     WHERE ${IN_PERIOD("o.sold_on")} AND o.channel = ANY($3)
     GROUP BY c.oid, c.name
     ORDER BY sales DESC, c.name NULLS LAST, c.oid
     LIMIT $4`;

const margin = (sales, cost) => (sales > 0 ? Math.round(((sales - cost) / sales) * 1000) / 10 : null);

module.exports = {
    title: "Profit by category",
    period: true,
    columns: [
        { key: "category", label: "Category", type: "text" },
        { key: "units_kept", label: "Units kept", type: "int", total: true },
        { key: "sales", label: "Sales", type: "money", total: true },
        { key: "cost", label: "Cost", type: "money", total: true, cost: true },
        { key: "profit", label: "Profit", type: "money", total: true, cost: true },
        { key: "margin", label: "Margin", type: "percent", total: true, cost: true },
    ],
    cost_totals: ["units_without_cost"],
    read: async ({ period, channels, limit }) =>
        (await get_data({ text: SQL, values: [period.date_from, period.date_to, channels, limit] })).map((row) => ({ ...row, profit: row.sales - row.cost, margin: margin(row.sales, row.cost) })),
    totals: (rows) => {
        const totals = Object.fromEntries(["units_kept", "sales", "cost", "profit", "units_without_cost"].map((key) => [key, sum(rows, key)]));
        return { ...totals, margin: margin(totals.sales, totals.cost) };
    },
    note: "A return is taken off the period of its sale. Margin is profit divided by sales.",
};
