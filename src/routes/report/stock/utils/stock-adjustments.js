const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day } = require("../../../../utils/business-time");
const { IN_PERIOD } = require("../../utils/sql");

// Lines of verified adjustments by the day they were verified. A line's batch is the one it moved or
// the one it created; its cost is the typed cost of a new batch, otherwise the batch's own, since an
// out line carries none (as the adjustment's own page reads it).
const SQL = `
    SELECT to_char(${business_day("s.verified_on")}, 'YYYY-MM-DD') AS day, s.adjustment_number, s.reason, p.name AS product, i.batch_code AS batch,
           (CASE WHEN l.direction = 'in' THEN l.quantity ELSE 0 END)::int AS units_in,
           (CASE WHEN l.direction = 'out' THEN l.quantity ELSE 0 END)::int AS units_out,
           COALESCE(l.cost_price, i.cost_price)::float AS cost_price,
           (CASE WHEN l.direction = 'in' THEN l.quantity * COALESCE(l.cost_price, i.cost_price, 0) ELSE 0 END)::float AS value_in,
           (CASE WHEN l.direction = 'out' THEN l.quantity * COALESCE(l.cost_price, i.cost_price, 0) ELSE 0 END)::float AS value_out
      FROM ${TABLE.STOCK_ADJUSTMENT} s
      JOIN ${TABLE.STOCK_ADJUSTMENT_LINE} l ON l.adjustment_oid = s.oid
      JOIN ${TABLE.PRODUCT} p ON p.oid = l.product_oid
      LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = l.inventory_oid
     WHERE s.status = 'Verified' AND ${IN_PERIOD("s.verified_on")} AND ($3::text IS NULL OR s.reason = $3)
     ORDER BY s.verified_on, s.adjustment_number, l.created_on, l.oid
     LIMIT $4`;

module.exports = {
    title: "Stock adjustments",
    period: true,
    columns: [
        { key: "day", label: "Verified", type: "day" },
        { key: "adjustment_number", label: "Adjustment", type: "code" },
        { key: "reason", label: "Reason", type: "adjustment_reason" },
        { key: "product", label: "Product", type: "text" },
        { key: "batch", label: "Batch", type: "code" },
        { key: "units_in", label: "Units in", type: "int", total: true },
        { key: "units_out", label: "Units out", type: "int", total: true },
        { key: "cost_price", label: "Cost price", type: "money", cost: true },
        { key: "value_in", label: "Value in", type: "money", total: true, cost: true },
        { key: "value_out", label: "Value out", type: "money", total: true, cost: true },
    ],
    read: ({ query, period, limit }) => get_data({ text: SQL, values: [period.date_from, period.date_to, query.reason ?? null, limit] }),
    note: "Dated when the adjustment was verified. Value is at each batch's cost.",
};
