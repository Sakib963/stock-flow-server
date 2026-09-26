const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

// The same row the Categories list carries, plus the parent it belongs to.
const SELECT = `sc.oid, sc.name, sc.description, sc.category_code, sc.category_oid, sc.status, sc.created_on,
                c.name AS category_name,
                COALESCE(sc.edited_on, sc.created_on) AS last_action_on,
                COALESCE(sc.edited_by, sc.created_by) AS last_action_by,
                (sc.edited_by IS NOT NULL) AS last_action_is_edit,
                u.name AS last_action_by_name,
                r.name AS last_action_by_role`;

const FROM = `${TABLE.SUB_CATEGORIES} sc
              JOIN ${TABLE.CATEGORIES} c ON c.oid = sc.category_oid
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(sc.edited_by, sc.created_by)
              LEFT JOIN ${TABLE.ROLE} r ON r.oid = u.role_oid`;

const STATS = {
    active: `COUNT(*) FILTER (WHERE sc.status = 'Active')::int`,
    inactive: `COUNT(*) FILTER (WHERE sc.status = 'Inactive')::int`,
    products: `COALESCE(SUM((SELECT COUNT(*) FROM ${TABLE.PRODUCT} p WHERE p.sub_category_oid = sc.oid AND p.is_deleted = FALSE)), 0)::int`,
    empty: `COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ${TABLE.PRODUCT} p WHERE p.sub_category_oid = sc.oid AND p.is_deleted = FALSE))::int`,
};

const get_sub_category_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            search: ["sc.name", "sc.category_code", "sc.description", "c.name"],
            filters: { status: "sc.status", category_oid: "sc.category_oid" },
            sortable: { name: "sc.name", category_code: "sc.category_code", category_name: "c.name", status: "sc.status", created_on: "sc.created_on", last_action_on: "COALESCE(sc.edited_on, sc.created_on)" },
            default_sort: { key: "name", order: "asc" },
            stats: STATS,
            tie_breaker: "sc.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Sub-categories", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing sub-categories: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load sub-categories. Try again in a moment." });
    }
};

module.exports = get_sub_category_list;
