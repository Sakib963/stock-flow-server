const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { caller_for } = require("../utils/user-rules");

const LAST_SIGN_IN = `(SELECT MAX(s.created_on) FROM ${TABLE.AUTH_SESSION} s WHERE s.login_oid = l.oid)`;

const SELECT = `l.oid, l.name, l.email, l.mobile_number, l.designation, l.photo, l.status, l.must_change_password,
                l.role_oid, r.name AS role_name,
                ${LAST_SIGN_IN} AT TIME ZONE current_setting('TimeZone') AS last_sign_in_on`;

const FROM = `${TABLE.LOGIN} l LEFT JOIN ${TABLE.ROLE} r ON r.oid = l.role_oid`;

const get_user_list = async (request, res) => {
    try {
        const caller = await caller_for(request);
        const where = [];
        // The vendor's accounts are never shown to a business.
        if (!caller.system) where.push("r.scope IS DISTINCT FROM 'system'");
        // Someone who left is shown only when asked for.
        if (!request.query.status) where.push("l.status <> 'Deleted'");

        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            where,
            search: ["l.name", "l.email", "l.mobile_number", "l.designation"],
            filters: { status: "l.status", role: "l.role_oid" },
            sortable: { name: "lower(l.name)", role: "lower(r.name)", status: "l.status", last_sign_in_on: `COALESCE(${LAST_SIGN_IN}, '-infinity'::timestamp)` },
            default_sort: { key: "name", order: "asc" },
            stats: { active: `COUNT(*) FILTER (WHERE l.status = 'Active')::int`, inactive: `COUNT(*) FILTER (WHERE l.status = 'Inactive')::int`, never_signed_in: `COUNT(*) FILTER (WHERE ${LAST_SIGN_IN} IS NULL)::int` },
            tie_breaker: "l.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Users", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing users: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the users. Try again in a moment." });
    }
};

module.exports = get_user_list;
