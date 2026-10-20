const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { IN_PERIOD } = require("../../utils/sql");
const { sum } = require("../../utils/run-report");

// Kept units at the line price, each costed at its own batch, as sales analytics reads them.
const SQL = `
    SELECT p.name AS product, p.sku, c.name AS category,
           SUM(oi.quantity)::int AS units_sold, SUM(oi.returned_qty)::int AS units_returned, SUM(oi.quantity - oi.returned_qty)::int AS units_kept,
           SUM((oi.unit_price - COALESCE(oi.discount, 0)) * (oi.quantity - oi.returned_qty))::float AS sales,
           SUM(COALESCE(i.cost_price, 0) * (oi.quantity - oi.returned_qty))::float AS cost,
           COALESCE(SUM(oi.quantity - oi.returned_qty) FILTER (WHERE i.cost_price IS NULL), 0)::int AS units_without_cost
      FROM ${TABLE.ORDERS} o
      JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
      JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid
      LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
      LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = oi.inventory_oid
     WHERE ${IN_PERIOD("o.sold_on")} AND o.channel = ANY($3) AND ($4::text IS NULL OR p.category_oid = $4)
     GROUP BY p.oid, p.name, p.sku, c.name
     ORDER BY sales DESC, p.name, p.oid
     LIMIT $5`;

const margin = (sales, cost) => (sales > 0 ? Math.round(((sales - cost) / sales) * 1000) / 10 : null);

module.exports = {
    title: "Sales by product",
    period: true,
    columns: [
        { key: "product", label: "Product", type: "text" },
        { key: "sku", label: "SKU", type: "code" },
        { key: "category", label: "Category", type: "text" },
        { key: "units_sold", label: "Units sold", type: "int", total: true },
        { key: "units_returned", label: "Units returned", type: "int", total: true },
        { key: "units_kept", label: "Units kept", type: "int", total: true },
        { key: "sales", label: "Sales", type: "money", total: true },
        { key: "cost", label: "Cost", type: "money", total: true, cost: true },
        { key: "profit", label: "Profit", type: "money", total: true, cost: true },
        { key: "margin", label: "Margin", type: "percent", total: true, cost: true },
    ],
    cost_totals: ["units_without_cost"],
    read: async ({ query, period, channels, limit }) =>
        (await get_data({ text: SQL, values: [period.date_from, period.date_to, channels, query.category_oid ?? null, limit] })).map((row) => ({ ...row, profit: row.sales - row.cost, margin: margin(row.sales, row.cost) })),
    totals: (rows) => {
        const totals = Object.fromEntries(["units_sold", "units_returned", "units_kept", "sales", "cost", "profit", "units_without_cost"].map((key) => [key, sum(rows, key)]));
        return { ...totals, margin: margin(totals.sales, totals.cost) };
    },
    note: "A return is taken off the period of its sale. Margin is profit divided by sales.",
};
