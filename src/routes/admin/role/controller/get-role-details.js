const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { getLogActivities } = require("../../../../utils/activity-logger");
const { caller_of, VERSION } = require("../utils/role-grants");

const DETAILS_SQL = `
    SELECT r.oid, r.name, r.description, r.scope, r.is_system, r.status, ${VERSION} AS version,
           r.created_on, COALESCE(r.edited_on, r.created_on) AS last_action_on,
           COALESCE(r.edited_by, r.created_by) AS last_action_by, u.name AS last_action_by_name
      FROM ${TABLE.ROLE} r
      LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(r.edited_by, r.created_by)
     WHERE r.oid = $1`;

const CODES_SQL = `SELECT p.code FROM ${TABLE.ROLE_PERMISSION} rp JOIN ${TABLE.PERMISSION} p ON p.oid = rp.permission_oid WHERE rp.role_oid = $1 ORDER BY p.sort_order, p.code`;

const HOLDERS_SQL = `SELECT oid, name, email, status FROM ${TABLE.LOGIN} WHERE role_oid = $1 ORDER BY name`;

const get_role_details = async (request, res) => {
    const { oid } = request.params;
    try {
        const caller = await caller_of(request);
        const [details] = await get_data({ text: DETAILS_SQL, values: [oid] });
        if (!details || (details.scope === "system" && !caller.system)) return res.status(404).json({ code: 404, message: "That role does not exist.", data: null });

        const [codes, holders, activity] = await Promise.all([get_data({ text: CODES_SQL, values: [oid] }), get_data({ text: HOLDERS_SQL, values: [oid] }), getLogActivities("role", oid, 10)]);

        return res.status(200).json({
            code: 200,
            message: "Role details",
            data: {
                // Owner's grants are the system admin's to set; a business caller reads them only.
                details: { ...details, editable: caller.system || !details.is_system },
                codes: codes.map((c) => c.code),
                holders,
                activity: activity.map((a) => ({ oid: a.oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description })),
            },
        });
    } catch (e) {
        log.error(`An exception occurred while reading role ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the role. Try again in a moment." });
    }
};

module.exports = get_role_details;
