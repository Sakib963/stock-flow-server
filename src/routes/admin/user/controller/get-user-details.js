const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { getLogActivities } = require("../../../../utils/activity-logger");
const { describe_device } = require("../../../../auth/user-agent");
const { FROM: FEATURE_FROM, STATE } = require("../../feature/utils/feature-sql");
const { caller_for, beyond_reach, VERSION, IS_OWNER } = require("../utils/user-rules");

const DETAILS_SQL = `
    SELECT l.oid, l.name, l.email, l.mobile_number, l.designation, l.photo, l.status, l.must_change_password, ${VERSION} AS version,
           l.role_oid, r.name AS role_name, r.status AS role_status, r.scope, ${IS_OWNER} AS is_owner,
           l.created_on, COALESCE(l.edited_on, l.created_on) AS last_action_on, COALESCE(l.edited_by, l.created_by) AS last_action_by, u.name AS last_action_by_name,
           (SELECT MAX(s.created_on) FROM ${TABLE.AUTH_SESSION} s WHERE s.login_oid = l.oid) AT TIME ZONE current_setting('TimeZone') AS last_sign_in_on,
           (SELECT COUNT(*)::int FROM ${TABLE.LOGIN} o WHERE o.role_oid = l.role_oid AND o.status = 'Active' AND o.oid <> l.oid) AS other_active_holders
      FROM ${TABLE.LOGIN} l
      LEFT JOIN ${TABLE.ROLE} r ON r.oid = l.role_oid
      LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(l.edited_by, l.created_by)
     WHERE l.oid = $1`;

const FEATURES_SQL = `
    SELECT m.oid, m.parent_oid, m.slug, m.label, m.label_bn, m.permission_code, ${STATE} AS state
      FROM ${FEATURE_FROM}
     ORDER BY COALESCE(p.sort_order, m.sort_order), COALESCE(p.oid, m.oid), (m.parent_oid IS NOT NULL), m.sort_order`;

const ACTIONS_SQL = `
    SELECT p.code, p.module, p.feature, p.action, p.label, p.label_bn, p.is_sensitive
      FROM ${TABLE.ROLE_PERMISSION} rp JOIN ${TABLE.PERMISSION} p ON p.oid = rp.permission_oid
     WHERE rp.role_oid = $1
     ORDER BY p.sort_order, p.code`;

// Like the person's own device list: a session whose refresh token has idled out is not a device
// they are really signed in on.
const SESSIONS_SQL = `
    SELECT s.oid, s.ip_address, s.user_agent,
           s.created_on AT TIME ZONE current_setting('TimeZone') AS signed_in_on,
           s.last_used_on AT TIME ZONE current_setting('TimeZone') AS last_used_on
      FROM ${TABLE.AUTH_SESSION} s
     WHERE s.login_oid = $1 AND s.status = 'Active' AND s.expires_on > LOCALTIMESTAMP
       AND EXISTS (SELECT 1 FROM ${TABLE.AUTH_REFRESH_TOKEN} t WHERE t.session_oid = s.oid AND t.status = 'Active' AND t.expires_on > LOCALTIMESTAMP)
     ORDER BY s.last_used_on DESC`;

const get_user_details = async (request, res) => {
    const { oid } = request.params;
    try {
        const caller = await caller_for(request);
        const [details] = await get_data({ text: DETAILS_SQL, values: [oid] });
        if (!details || (details.scope === "system" && !caller.system)) return res.status(404).json({ code: 404, message: "That person does not exist.", data: null });

        const [features, actions, sessions, activity, out_of_reach] = await Promise.all([
            get_data({ text: FEATURES_SQL }),
            details.role_oid ? get_data({ text: ACTIONS_SQL, values: [details.role_oid] }) : [],
            get_data({ text: SESSIONS_SQL, values: [oid] }),
            getLogActivities("user", oid, 10),
            details.role_oid ? beyond_reach({ get_data }, details.role_oid, caller) : [],
        ]);

        const { scope, other_active_holders, ...rest } = details;
        return res.status(200).json({
            code: 200,
            message: "User details",
            data: {
                details: {
                    ...rest,
                    self: details.oid === caller.login_oid,
                    within_reach: out_of_reach.length === 0,
                    last_owner: details.is_owner && details.status === "Active" && other_active_holders === 0,
                },
                access: { features, actions },
                sessions: sessions.map((s) => ({ id: s.oid, device: describe_device(s.user_agent), ip_address: s.ip_address, signed_in_on: s.signed_in_on, last_used_on: s.last_used_on })),
                activity: activity.map((a) => ({ oid: a.oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description })),
            },
        });
    } catch (e) {
        log.error(`An exception occurred while reading user ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load this person. Try again in a moment." });
    }
};

module.exports = get_user_details;
