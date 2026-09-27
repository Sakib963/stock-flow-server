const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

// Sellable, not on hand: quantity_available minus the Active holds, clamped at zero per batch, the
// same figure the category, sub-category and brand pages report. Only ready_for_sale batches: internal
// use stock is never sold and unpriced stock cannot be yet.
const STOCK = `LEFT JOIN LATERAL (
                  SELECT COALESCE(SUM(GREATEST(i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM ${TABLE.STOCK_HOLD} h WHERE h.inventory_oid = i.oid AND h.status = 'Active'), 0), 0)), 0)::int AS sellable
                  FROM ${TABLE.INVENTORY} i
                  WHERE i.product_oid = p.oid AND i.status = 'ready_for_sale'
              ) st ON TRUE`;

// A 48px square is enough for the 24px thumbnail on a sharp screen, so the list never pulls a phone photo per row.
const SELECT = `p.oid, p.name, p.sku, p.photo, p.unit_type, p.restock_threshold::int AS restock_threshold, p.status, p.created_on,
                replace(p.photo, '/image/upload/', '/image/upload/c_fill,w_48,h_48,f_auto,q_auto/') AS photo_thumb,
                p.category_oid, c.name AS category_name, p.sub_category_oid, s.name AS sub_category_name, p.brand_oid, b.name AS brand_name,
                st.sellable,
                COALESCE(p.edited_on, p.created_on) AS last_action_on,
                COALESCE(p.edited_by, p.created_by) AS last_action_by,
                (p.edited_by IS NOT NULL) AS last_action_is_edit,
                u.name AS last_action_by_name,
                r.name AS last_action_by_role`;

const FROM = `${TABLE.PRODUCT} p
              LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
              LEFT JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
              LEFT JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(p.edited_by, p.created_by)
              LEFT JOIN ${TABLE.ROLE} r ON r.oid = u.role_oid
              ${STOCK}`;

const STATS = {
    active: `COUNT(*) FILTER (WHERE p.status = 'Active')::int`,
    inactive: `COUNT(*) FILTER (WHERE p.status = 'Inactive')::int`,
    low: `COUNT(*) FILTER (WHERE p.status = 'Active' AND st.sellable > 0 AND st.sellable <= p.restock_threshold)::int`,
    out: `COUNT(*) FILTER (WHERE p.status = 'Active' AND st.sellable = 0)::int`,
};

const get_product_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            where: ["p.is_deleted = FALSE"],
            search: ["p.name", "p.sku", "p.description"],
            filters: { status: "p.status", category_oid: "p.category_oid", sub_category_oid: "p.sub_category_oid", brand_oid: "p.brand_oid" },
            sortable: { name: "p.name", sku: "p.sku", stock: "st.sellable", status: "p.status", created_on: "p.created_on", last_action_on: "COALESCE(p.edited_on, p.created_on)" },
            default_sort: { key: "name", order: "asc" },
            stats: STATS,
            tie_breaker: "p.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Products", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing products: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load products. Try again in a moment." });
    }
};

module.exports = get_product_list;
