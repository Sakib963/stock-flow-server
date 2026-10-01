const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { escape_like } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { sees_money } = require("../../utils/sees-money");

// Each product with its batches, newest first, so a line can pick the batch it moves and see how much
// of it is free of holds: a decrease may take only that.
const PRODUCTS_SQL = `
      SELECT p.oid, p.name, p.sku, p.has_expiry, p.unit_type,
             replace(p.photo, '/image/upload/', '/image/upload/c_fill,w_48,h_48,f_auto,q_auto/') AS photo_thumb,
             COALESCE(b.batches, '[]'::json) AS batches
        FROM ${TABLE.PRODUCT} p
        LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object(
                       'oid', i.oid, 'batch_code', i.batch_code, 'intended_use', i.intended_use,
                       'on_hand', i.quantity_available::int,
                       'free', (i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM ${TABLE.STOCK_HOLD} h WHERE h.inventory_oid = i.oid AND h.status = 'Active'), 0))::int,
                       'cost_price', i.cost_price::bigint, 'budget_per_unit', (SELECT (COALESCE(b.ad_run_cost, 0) + COALESCE(b.packaging_cost, 0) + COALESCE(b.gift_cost, 0) + COALESCE(b.content_creation_cost, 0) + COALESCE(b.influencer_cost, 0))::bigint FROM ${TABLE.COST_BUDGET} b WHERE b.purchase_details_oid = i.purchase_details_oid OR b.stock_adjustment_line_oid = i.stock_adjustment_line_oid), 'selling_price', i.selling_price::bigint, 'maximum_discount', i.maximum_discount::bigint,
                       'warehouse_name', w.name, 'expiry_date', to_char(i.expiry_date, 'YYYY-MM-DD')
                   ) ORDER BY i.created_on DESC, i.oid) AS batches
              FROM ${TABLE.INVENTORY} i
              LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = i.warehouse_oid
             WHERE i.product_oid = p.oid
        ) b ON TRUE
       WHERE p.is_deleted = FALSE AND p.status = 'Active'
         AND ($1::text IS NULL OR p.name ILIKE $1 OR p.sku ILIKE $1)
       ORDER BY p.name, p.oid
       LIMIT $2`;

const get_product_list_for_adjustment = async (request, res) => {
      const term = typeof request.query.search === "string" ? request.query.search.trim() : "";
      try {
            const [rows, money] = await Promise.all([get_data({ text: PRODUCTS_SQL, values: [term ? `%${escape_like(term)}%` : null, request.query.limit] }), sees_money(request)]);
            const shown = money ? rows : rows.map((row) => ({ ...row, batches: row.batches.map(({ cost_price, budget_per_unit, ...batch }) => batch) }));
            return res.status(200).json({ code: 200, message: "Products", data: shown });
      } catch (e) {
            log.error(`An exception occurred while searching products for a stock adjustment: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not search products. Try again in a moment." });
      }
};

module.exports = get_product_list_for_adjustment;
