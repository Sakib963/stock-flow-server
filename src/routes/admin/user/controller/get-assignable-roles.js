const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { caller_for } = require("../utils/user-rules");

// Only roles the caller could have made themselves: every action in them is one they hold.
const ROLES_SQL = `
    SELECT r.oid, r.name, r.description,
           (SELECT COUNT(*)::int FROM ${TABLE.LOGIN} l WHERE l.role_oid = r.oid AND l.status <> 'Deleted') AS holders,
           COALESCE((SELECT json_agg(json_build_object('code', p.code, 'action', p.action, 'label', p.label, 'label_bn', p.label_bn) ORDER BY p.sort_order)
                       FROM ${TABLE.ROLE_PERMISSION} rp JOIN ${TABLE.PERMISSION} p ON p.oid = rp.permission_oid
                      WHERE rp.role_oid = r.oid AND p.is_sensitive), '[]') AS sensitive
      FROM ${TABLE.ROLE} r
     WHERE r.status = 'Active'
       AND (r.scope = 'business' OR $2)
       AND NOT EXISTS (SELECT 1 FROM ${TABLE.ROLE_PERMISSION} rp JOIN ${TABLE.PERMISSION} p ON p.oid = rp.permission_oid
                        WHERE rp.role_oid = r.oid AND NOT (p.code = ANY($1::text[])))
     ORDER BY lower(r.name)`;

const get_assignable_roles = async (request, res) => {
    try {
        const caller = await caller_for(request);
        const rows = await get_data({ text: ROLES_SQL, values: [[...caller.held], caller.system] });
        return res.status(200).json({ code: 200, message: "Roles you can give", data: rows });
    } catch (e) {
        log.error(`An exception occurred while listing assignable roles: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the roles. Try again in a moment." });
    }
};

module.exports = get_assignable_roles;
