const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { caller_of } = require("../utils/role-grants");

const HOLDERS = `(SELECT COUNT(*) FROM ${TABLE.LOGIN} l WHERE l.role_oid = r.oid)::int`;
const ACTIONS = `(SELECT COUNT(*) FROM ${TABLE.ROLE_PERMISSION} rp WHERE rp.role_oid = r.oid)::int`;
const SENSITIVE = `(SELECT COUNT(*) FROM ${TABLE.ROLE_PERMISSION} rp JOIN ${TABLE.PERMISSION} p ON p.oid = rp.permission_oid WHERE rp.role_oid = r.oid AND p.is_sensitive)::int`;

const SELECT = `r.oid, r.name, r.description, r.scope, r.is_system, r.status,
                ${HOLDERS} AS holders, ${ACTIONS} AS actions, ${SENSITIVE} AS sensitive,
                COALESCE(r.edited_on, r.created_on) AS last_action_on,
                COALESCE(r.edited_by, r.created_by) AS last_action_by,
                u.name AS last_action_by_name`;

const FROM = `${TABLE.ROLE} r LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(r.edited_by, r.created_by)`;

const get_role_list = async (request, res) => {
    try {
        const caller = await caller_of(request);
        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            // The vendor's role is never shown to a business.
            where: caller.system ? [] : ["r.scope = 'business'"],
            search: ["r.name", "r.description"],
            filters: { status: "r.status" },
            sortable: { name: "lower(r.name)", holders: HOLDERS, actions: ACTIONS, status: "r.status", last_action_on: "COALESCE(r.edited_on, r.created_on)" },
            default_sort: { key: "name", order: "asc" },
            stats: { active: `COUNT(*) FILTER (WHERE r.status = 'Active')::int`, inactive: `COUNT(*) FILTER (WHERE r.status = 'Inactive')::int` },
            tie_breaker: "r.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Roles", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing roles: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the roles. Try again in a moment." });
    }
};

module.exports = get_role_list;
