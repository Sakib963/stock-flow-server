const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { escape_like } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { BATCH_BUDGETS, BUDGET_JOIN } = require("../utils/campaign-lines");

// Products with the batches still on the shelf, newest first, each with its marketing budgets per unit
// and its units, which is what the campaign's planned budget is worked out from.
const get_batches_for_campaign = async (request, res) => {
    const search = request.query.search ? `%${escape_like(request.query.search)}%` : null;
    try {
        const rows = await get_data({
            text: `SELECT p.oid, p.name, p.sku, c.name AS category_name, sc.name AS sub_category_name,
                          json_agg(json_build_object('oid', b.oid, 'batch_code', b.batch_code, 'units', b.units, 'on_hand', b.on_hand, 'warehouse_name', b.warehouse_name,
                                                     'influencer_cost', b.influencer_cost, 'ad_run_cost', b.ad_run_cost, 'gift_cost', b.gift_cost, 'content_creation_cost', b.content_creation_cost)
                                   ORDER BY b.created_on DESC, b.oid) AS batches
                     FROM ${TABLE.PRODUCT} p
                     LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
                     LEFT JOIN ${TABLE.SUB_CATEGORIES} sc ON sc.oid = p.sub_category_oid
                     JOIN LATERAL (
                          SELECT i.oid, i.batch_code, i.created_on, i.initial_quantity::int AS units, i.quantity_available::int AS on_hand, w.name AS warehouse_name, ${BATCH_BUDGETS}
                            FROM ${TABLE.INVENTORY} i
                            LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = i.warehouse_oid
                            ${BUDGET_JOIN}
                           WHERE i.product_oid = p.oid AND i.quantity_available > 0) b ON true
                    WHERE p.is_deleted = FALSE AND p.status = 'Active'
                      AND ($1::text IS NULL OR p.name ILIKE $1 OR p.sku ILIKE $1)
                    GROUP BY p.oid, p.name, p.sku, c.name, sc.name
                    ORDER BY c.name, sc.name, p.name, p.oid
                    LIMIT 30`,
            values: [search],
        });
        return res.status(200).json({ code: 200, message: "Products", data: rows });
    } catch (e) {
        log.error(`An exception occurred while searching batches for a campaign: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not search the products. Try again in a moment." });
    }
};

module.exports = get_batches_for_campaign;
