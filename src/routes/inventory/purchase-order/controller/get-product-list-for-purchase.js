const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { escape_like } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

// Any supplier can sell any product, so the whole catalogue is searched. The last price paid is the
// final price on the most recent verified line, from whichever supplier. Sold counts orders by
// sold_on, the moment either channel's order became a sale, less what came back.
const PRODUCTS_SQL = `
      SELECT p.oid, p.name, p.sku, p.restock_threshold::int AS restock_threshold,
             replace(p.photo, '/image/upload/', '/image/upload/c_fill,w_48,h_48,f_auto,q_auto/') AS photo_thumb,
             st.sellable, sold.sold_30_days,
             last.unit_price AS last_unit_price, last.supplier_name AS last_supplier_name, last.verified_on AS last_bought_on
        FROM ${TABLE.PRODUCT} p
        LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(GREATEST(i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM ${TABLE.STOCK_HOLD} h WHERE h.inventory_oid = i.oid AND h.status = 'Active'), 0), 0)), 0)::int AS sellable
              FROM ${TABLE.INVENTORY} i
             WHERE i.product_oid = p.oid AND i.status = 'ready_for_sale'
        ) st ON TRUE
        LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(oi.quantity - oi.returned_qty), 0)::int AS sold_30_days
              FROM ${TABLE.ORDER_ITEMS} oi
              JOIN ${TABLE.ORDERS} o ON o.oid = oi.order_oid
             WHERE oi.product_oid = p.oid AND o.sold_on >= CURRENT_TIMESTAMP - interval '30 days'
        ) sold ON TRUE
        LEFT JOIN LATERAL (
            SELECT d.verified_unit_price::bigint AS unit_price, s.name AS supplier_name, x.verified_on
              FROM ${TABLE.PURCHASE_DETAILS} d
              JOIN ${TABLE.PURCHASE} x ON x.oid = d.purchase_oid
              JOIN ${TABLE.SUPPLIER} s ON s.oid = x.supplier_oid
             WHERE d.product_oid = p.oid AND x.status = 'Verified' AND d.verified_quantity > 0
             ORDER BY x.verified_on DESC NULLS LAST, d.oid
             LIMIT 1
        ) last ON TRUE
       WHERE p.is_deleted = FALSE AND p.status = 'Active'
         AND ($1::text IS NULL OR p.name ILIKE $1 OR p.sku ILIKE $1)
       ORDER BY p.name, p.oid
       LIMIT $2`;

const get_product_list_for_purchase = async (request, res) => {
      const term = typeof request.query.search === "string" ? request.query.search.trim() : "";
      try {
            const rows = await get_data({ text: PRODUCTS_SQL, values: [term ? `%${escape_like(term)}%` : null, request.query.limit] });
            return res.status(200).json({ code: 200, message: "Products", data: rows });
      } catch (e) {
            log.error(`An exception occurred while searching products for a purchase order: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not search products. Try again in a moment." });
      }
};

module.exports = get_product_list_for_purchase;
