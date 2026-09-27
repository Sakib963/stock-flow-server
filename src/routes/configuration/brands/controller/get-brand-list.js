const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

const SELECT = `b.oid, b.name, b.description, b.origin_country, b.status, b.created_on,
                COALESCE(b.edited_on, b.created_on) AS last_action_on,
                COALESCE(b.edited_by, b.created_by) AS last_action_by,
                (b.edited_by IS NOT NULL) AS last_action_is_edit,
                u.name AS last_action_by_name,
                r.name AS last_action_by_role`;

const FROM = `${TABLE.BRANDS} b
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(b.edited_by, b.created_by)
              LEFT JOIN ${TABLE.ROLE} r ON r.oid = u.role_oid`;

const STATS = {
    active: `COUNT(*) FILTER (WHERE b.status = 'Active')::int`,
    inactive: `COUNT(*) FILTER (WHERE b.status = 'Inactive')::int`,
    products: `COALESCE(SUM((SELECT COUNT(*) FROM ${TABLE.PRODUCT} p WHERE p.brand_oid = b.oid AND p.is_deleted = FALSE)), 0)::int`,
    empty: `COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ${TABLE.PRODUCT} p WHERE p.brand_oid = b.oid AND p.is_deleted = FALSE))::int`,
};

const get_brand_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            search: ["b.name", "b.description"],
            filters: { status: "b.status" },
            sortable: { name: "b.name", status: "b.status", created_on: "b.created_on", last_action_on: "COALESCE(b.edited_on, b.created_on)" },
            default_sort: { key: "name", order: "asc" },
            stats: STATS,
            tie_breaker: "b.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Brands", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing brands: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load brands. Try again in a moment." });
    }
};

module.exports = get_brand_list;
