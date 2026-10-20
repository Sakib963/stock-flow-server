const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day_start } = require("../../../../utils/business-time");

const START = business_day_start("$1");
const END = business_day_start("$2::date + 1");
const DURING = `m.created_on >= ${START} AND m.created_on < ${END}`;
// A batch's carried_over row is the ledger's first balance, so it belongs with the opening, not with
// the period's movements, or a period spanning the ledger's start shows its whole shelf as adjusted.
const MOVED = `${DURING} AND m.reason <> 'carried_over'`;
const IN = (condition) => `COALESCE(SUM(m.quantity) FILTER (WHERE ${MOVED} AND ${condition}), 0)::int`;

// Per product from the ledger, every movement signed, so opening plus the columns is the closing by
// construction. A gift that came back with a refused parcel is restocked as returned with the gift as
// its source: it nets against Given away, not against customers' returns. Out on orders counts
// parcels when they leave, refused ones included (they come back under Returned), so it is not the
// units in Sales by product.
const SQL = `
    SELECT p.name AS product, p.sku, c.name AS category,
           COALESCE(SUM(m.quantity) FILTER (WHERE m.created_on < ${START} OR (${DURING} AND m.reason = 'carried_over')), 0)::int AS opening,
           ${IN("m.reason = 'received'")} AS units_received,
           ${IN("m.reason IN ('sold', 'dispatched')")} AS out_on_orders,
           ${IN("m.reason = 'returned' AND g.oid IS NULL")} AS returned,
           ${IN("(m.reason = 'given_away' OR (m.reason = 'returned' AND g.oid IS NOT NULL))")} AS given_away,
           ${IN("m.reason IN ('disposed', 'dispose_reversed')")} AS disposed,
           ${IN("m.reason NOT IN ('received', 'sold', 'dispatched', 'returned', 'given_away', 'disposed', 'dispose_reversed')")} AS adjusted,
           COALESCE(SUM(m.quantity), 0)::int AS closing
      FROM ${TABLE.STOCK_MOVEMENT} m
      JOIN ${TABLE.INVENTORY} i ON i.oid = m.inventory_oid
      JOIN ${TABLE.PRODUCT} p ON p.oid = m.product_oid
      LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
      LEFT JOIN ${TABLE.GIVEAWAY} g ON g.oid = m.source_oid AND m.reason = 'returned'
     WHERE m.created_on < ${END}
       AND ($3::text IS NULL OR i.warehouse_oid = $3) AND ($4::text IS NULL OR p.category_oid = $4)
     GROUP BY p.oid, p.name, p.sku, c.name
    HAVING COALESCE(SUM(m.quantity) FILTER (WHERE m.created_on < ${START}), 0) <> 0 OR COUNT(*) FILTER (WHERE ${DURING}) > 0
     ORDER BY p.name, p.oid
     LIMIT $5`;

module.exports = {
    title: "Stock movement summary",
    period: true,
    columns: [
        { key: "product", label: "Product", type: "text" },
        { key: "sku", label: "SKU", type: "code" },
        { key: "category", label: "Category", type: "text" },
        { key: "opening", label: "Opening", type: "int", total: true },
        { key: "units_received", label: "Received", type: "int", total: true },
        { key: "out_on_orders", label: "Out on orders", type: "int", total: true },
        { key: "returned", label: "Returned", type: "int", total: true },
        { key: "given_away", label: "Given away", type: "int", total: true },
        { key: "disposed", label: "Disposed", type: "int", total: true },
        { key: "adjusted", label: "Adjusted", type: "int", total: true },
        { key: "closing", label: "Closing", type: "int", total: true },
    ],
    read: ({ query, period, limit }) => get_data({ text: SQL, values: [period.date_from, period.date_to, query.warehouse_oid ?? null, query.category_oid ?? null, limit] }),
    note: "Units, signed: opening plus every column is the closing. Out on orders counts parcels when they leave, so a refused parcel is out and then returned. Adjusted includes opening stock entries.",
};
