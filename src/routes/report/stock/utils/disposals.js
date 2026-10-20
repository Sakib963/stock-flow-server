const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day } = require("../../../../utils/business-time");
const { IN_PERIOD } = require("../../utils/sql");

// Lines of approved disposals, by the day they were approved. A damaged return becomes a disposal
// approved at once that moves no stock (its units left at the sale), so it is marked: it counts as a
// loss, but not against the shelf, and the movement summary's Disposed leaves it out.
const SQL = `
    SELECT to_char(${business_day("d.approved_on")}, 'YYYY-MM-DD') AS day, d.dispose_no, p.name AS product, i.batch_code AS batch, l.reason,
           EXISTS (SELECT 1 FROM ${TABLE.RETURN_DETAILS} rd WHERE rd.dispose_oid = d.oid) AS from_return,
           l.dispose_quantity::int AS quantity, COALESCE(l.cost_price, i.cost_price)::float AS cost_price,
           (l.dispose_quantity * COALESCE(l.cost_price, i.cost_price, 0))::float AS value_at_cost
      FROM ${TABLE.PRODUCT_DISPOSE} d
      JOIN ${TABLE.DISPOSE_DETAILS} l ON l.dispose_oid = d.oid
      JOIN ${TABLE.PRODUCT} p ON p.oid = l.product_oid
      LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = l.inventory_oid
     WHERE d.status = 'Approved' AND ${IN_PERIOD("d.approved_on")} AND ($3::text IS NULL OR l.reason = $3)
     ORDER BY d.approved_on, d.dispose_no, p.name, l.oid
     LIMIT $4`;

module.exports = {
    title: "Disposals",
    period: true,
    columns: [
        { key: "day", label: "Approved", type: "day" },
        { key: "dispose_no", label: "Disposal", type: "code" },
        { key: "product", label: "Product", type: "text" },
        { key: "batch", label: "Batch", type: "code" },
        { key: "reason", label: "Reason", type: "dispose_reason" },
        { key: "from_return", label: "From a return", type: "yes_no" },
        { key: "quantity", label: "Quantity", type: "int", total: true },
        { key: "cost_price", label: "Cost price", type: "money", cost: true },
        { key: "value_at_cost", label: "Value at cost", type: "money", total: true, cost: true },
    ],
    read: ({ query, period, limit }) => get_data({ text: SQL, values: [period.date_from, period.date_to, query.reason ?? null, limit] }),
    note: "Lines marked from a return are damaged returns: a loss, but their stock left at the sale, so they are also in Returns and not in the movement summary's Disposed.",
};
