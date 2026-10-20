const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day_start, business_today } = require("../../../../utils/business-time");
const { HELD } = require("./held");

// Active products whose free stock (on hand less holds) is at or below their restock level, which takes
// in a product with no level once it is out (0 at 0), so nothing runs out unseen. A product
// that is only kept for own use, such as packaging, counts its own-use batches, which read 0 sellable
// everywhere else; one that is sold counts every batch but those, stock waiting for a price included,
// since it is on the shelf. A product with no batch is 0.
const SQL = `
    WITH stock AS (
        SELECT p.oid, CASE WHEN BOOL_OR(i.status <> 'internal_use') THEN COALESCE(SUM(GREATEST(i.quantity_available - COALESCE(h.held, 0), 0)) FILTER (WHERE i.status <> 'internal_use'), 0)
                    ELSE COALESCE(SUM(GREATEST(i.quantity_available - COALESCE(h.held, 0), 0)), 0) END AS in_stock
          FROM ${TABLE.PRODUCT} p
          LEFT JOIN ${TABLE.INVENTORY} i ON i.product_oid = p.oid
          LEFT JOIN ${HELD} h ON h.inventory_oid = i.oid
         WHERE p.status = 'Active' AND NOT p.is_deleted AND ($1::text IS NULL OR p.category_oid = $1)
         GROUP BY p.oid
    ),
    sold AS (
        SELECT oi.product_oid, SUM(oi.quantity - oi.returned_qty) AS units
          FROM ${TABLE.ORDERS} o
          JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
         WHERE o.sold_on >= ${business_day_start(`${business_today} - 29`)}
         GROUP BY oi.product_oid
    )
    SELECT p.name AS product, p.sku, c.name AS category, s.in_stock::int AS in_stock, p.restock_threshold::int AS restock_at,
           COALESCE(sold.units, 0)::int AS sold_30_days, last.supplier AS last_supplier, last.unit_price::float AS last_cost
      FROM stock s
      JOIN ${TABLE.PRODUCT} p ON p.oid = s.oid
      LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
      LEFT JOIN sold ON sold.product_oid = p.oid
      LEFT JOIN LATERAL (
          SELECT su.name AS supplier, COALESCE(d.verified_unit_price, d.ordered_unit_price) AS unit_price
            FROM ${TABLE.PURCHASE_DETAILS} d
            JOIN ${TABLE.PURCHASE} pu ON pu.oid = d.purchase_oid AND pu.status = 'Verified'
            JOIN ${TABLE.SUPPLIER} su ON su.oid = pu.supplier_oid
           WHERE d.product_oid = p.oid
           ORDER BY pu.verified_on DESC
           LIMIT 1
      ) last ON TRUE
     WHERE s.in_stock <= p.restock_threshold
     ORDER BY s.in_stock = 0 DESC, s.in_stock::float / NULLIF(p.restock_threshold, 0) NULLS FIRST, p.name, p.oid
     LIMIT $2`;

module.exports = {
    title: "Low and out of stock",
    period: false,
    columns: [
        { key: "product", label: "Product", type: "text" },
        { key: "sku", label: "SKU", type: "code" },
        { key: "category", label: "Category", type: "text" },
        { key: "in_stock", label: "In stock", type: "int" },
        { key: "restock_at", label: "Restock at", type: "int" },
        { key: "sold_30_days", label: "Sold in 30 days", type: "int" },
        { key: "last_supplier", label: "Last supplier", type: "text" },
        { key: "last_cost", label: "Last cost", type: "money", cost: true },
    ],
    read: ({ query, limit }) => get_data({ text: SQL, values: [query.category_oid ?? null, limit] }),
    note: "As at now, emptiest first. In stock is on hand less what orders hold; stock kept for own use counts only for a product that is not sold. A product with no restock level shows once it is out.",
};
