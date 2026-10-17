const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { FROM, KIND, STATE } = require("../utils/feature-sql");

const SELECT = `m.oid, m.slug, m.label, m.label_bn, m.icon, m.route, m.permission_code, m.is_new,
                ${KIND} AS kind, ${STATE} AS state,
                p.label AS module_label, p.label_bn AS module_label_bn,
                COALESCE(m.edited_on, m.created_on) AS last_action_on,
                COALESCE(m.edited_by, m.created_by) AS last_action_by,
                u.name AS last_action_by_name`;

const STATS = {
    on: `COUNT(*) FILTER (WHERE ${STATE} = 'On')::int`,
    disabled: `COUNT(*) FILTER (WHERE ${STATE} = 'Disabled')::int`,
    hidden: `COUNT(*) FILTER (WHERE ${STATE} = 'Hidden')::int`,
};

const get_feature_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            search: ["m.label", "m.label_bn", "m.route", "m.permission_code", "p.label"],
            filters: { state: STATE, kind: KIND },
            // The menu's own order: each module, then its features.
            sortable: { position: "COALESCE(p.sort_order, m.sort_order), COALESCE(p.oid, m.oid), (m.parent_oid IS NOT NULL), m.sort_order", label: "m.label", module: "p.label", state: STATE, last_action_on: "COALESCE(m.edited_on, m.created_on)" },
            default_sort: { key: "position", order: "asc" },
            stats: STATS,
            tie_breaker: "m.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Features", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing features: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the features. Try again in a moment." });
    }
};

module.exports = get_feature_list;
