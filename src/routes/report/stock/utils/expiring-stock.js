const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_today } = require("../../../../utils/business-time");
const { HELD } = require("./held");

// Batches with stock that expire within the chosen number of days (60 when none is given), the
// soonest first and the already expired at the top. Sellable and value read as on Stock on hand.
const SQL = `
    WITH until AS (SELECT ${business_today} + COALESCE($1::int, 60) AS day)
    SELECT p.name AS product, p.sku, c.name AS category, w.name AS warehouse, i.batch_code AS batch,
           to_char(i.expiry_date, 'YYYY-MM-DD') AS expiry, (i.expiry_date - ${business_today})::int AS days_left,
           i.quantity_available::int AS on_hand,
           (CASE WHEN i.status = 'ready_for_sale' THEN GREATEST(i.quantity_available - COALESCE(h.held, 0), 0) ELSE 0 END)::int AS sellable,
           i.cost_price::float AS cost_price, (i.cost_price * i.quantity_available)::float AS value_at_cost
      FROM ${TABLE.INVENTORY} i
      JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
      LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
      LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = i.warehouse_oid
      LEFT JOIN ${HELD} h ON h.inventory_oid = i.oid
     WHERE i.quantity_available > 0 AND NOT p.is_deleted AND i.expiry_date IS NOT NULL AND i.expiry_date <= (SELECT day FROM until)
       AND ($2::text IS NULL OR i.warehouse_oid = $2) AND ($3::text IS NULL OR p.category_oid = $3)
     ORDER BY i.expiry_date, p.name, i.oid
     LIMIT $4`;

module.exports = {
    title: "Expiring stock",
    period: false,
    columns: [
        { key: "product", label: "Product", type: "text" },
        { key: "sku", label: "SKU", type: "code" },
        { key: "category", label: "Category", type: "text" },
        { key: "warehouse", label: "Warehouse", type: "text" },
        { key: "batch", label: "Batch", type: "code" },
        { key: "expiry", label: "Expiry", type: "day" },
        { key: "days_left", label: "Days left", type: "int" },
        { key: "on_hand", label: "On hand", type: "int", total: true },
        { key: "sellable", label: "Sellable", type: "int", total: true },
        { key: "cost_price", label: "Cost price", type: "money", cost: true },
        { key: "value_at_cost", label: "Value at cost", type: "money", total: true, cost: true },
    ],
    read: ({ query, limit }) => get_data({ text: SQL, values: [query.within_days ?? null, query.warehouse_oid ?? null, query.category_oid ?? null, limit] }),
    note: "As at now, soonest first. Days left below 0 have already expired. Value is on hand at each batch's cost.",
};
