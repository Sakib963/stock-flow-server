const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { HELD } = require("./held");

// Every batch with stock, as product-stock-stats reads it: sellable only on ready_for_sale batches and
// never below 0 (a disposal can leave holds above on hand), value at cost on everything physically
// there, because a held unit is still owned. Deleted products are left out, as on the stock overview.
const SQL = `
    SELECT p.name AS product, p.sku, c.name AS category, w.name AS warehouse, a.name AS aisle, i.batch_code AS batch,
           to_char(i.expiry_date, 'YYYY-MM-DD') AS expiry, i.status AS batch_status,
           i.quantity_available::int AS on_hand, COALESCE(h.held, 0)::int AS held,
           (CASE WHEN i.status = 'ready_for_sale' THEN GREATEST(i.quantity_available - COALESCE(h.held, 0), 0) ELSE 0 END)::int AS sellable,
           i.selling_price::float AS selling_price, i.cost_price::float AS cost_price, (i.cost_price * i.quantity_available)::float AS value_at_cost
      FROM ${TABLE.INVENTORY} i
      JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
      LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
      LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = i.warehouse_oid
      LEFT JOIN ${TABLE.AISLE} a ON a.oid = i.aisle_oid
      LEFT JOIN ${HELD} h ON h.inventory_oid = i.oid
     WHERE i.quantity_available > 0 AND NOT p.is_deleted
       AND ($1::text IS NULL OR i.warehouse_oid = $1) AND ($2::text IS NULL OR p.category_oid = $2)
     ORDER BY p.name, i.batch_code, i.oid
     LIMIT $3`;

module.exports = {
    title: "Stock on hand",
    period: false,
    columns: [
        { key: "product", label: "Product", type: "text" },
        { key: "sku", label: "SKU", type: "code" },
        { key: "category", label: "Category", type: "text" },
        { key: "warehouse", label: "Warehouse", type: "text" },
        { key: "aisle", label: "Aisle", type: "text" },
        { key: "batch", label: "Batch", type: "code" },
        { key: "expiry", label: "Expiry", type: "day" },
        { key: "batch_status", label: "Use", type: "batch_status" },
        { key: "on_hand", label: "On hand", type: "int", total: true },
        { key: "held", label: "Held for orders", type: "int", total: true },
        { key: "sellable", label: "Sellable", type: "int", total: true },
        { key: "selling_price", label: "Selling price", type: "money" },
        { key: "cost_price", label: "Cost price", type: "money", cost: true },
        { key: "value_at_cost", label: "Value at cost", type: "money", total: true, cost: true },
    ],
    read: ({ query, limit }) => get_data({ text: SQL, values: [query.warehouse_oid ?? null, query.category_oid ?? null, limit] }),
    note: "As at now. Sellable is on hand less what online orders hold, on batches ready for sale. Value is on hand at each batch's own cost.",
};
