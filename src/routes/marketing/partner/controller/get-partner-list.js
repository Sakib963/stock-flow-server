const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

const SELECT = `p.oid, p.name, p.partner_type, p.platforms, p.handle, p.phone_number, p.status, p.created_on,
                COALESCE(p.edited_on, p.created_on) AS last_action_on,
                COALESCE(p.edited_by, p.created_by) AS last_action_by,
                (p.edited_by IS NOT NULL) AS last_action_is_edit,
                u.name AS last_action_by_name,
                r.name AS last_action_by_role`;

const FROM = `${TABLE.PARTNER} p
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(p.edited_by, p.created_by)
              LEFT JOIN ${TABLE.ROLE} r ON r.oid = u.role_oid`;

const STATS = {
    active: `COUNT(*) FILTER (WHERE p.status = 'Active')::int`,
    inactive: `COUNT(*) FILTER (WHERE p.status = 'Inactive')::int`,
};

const get_partner_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            search: ["p.name", "p.handle", "p.phone_number"],
            filters: { status: "p.status", partner_type: "p.partner_type" },
            sortable: { name: "p.name", partner_type: "p.partner_type", status: "p.status", created_on: "p.created_on", last_action_on: "COALESCE(p.edited_on, p.created_on)" },
            default_sort: { key: "name", order: "asc" },
            stats: STATS,
            tie_breaker: "p.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Partners", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing partners: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the partners. Try again in a moment." });
    }
};

module.exports = get_partner_list;
