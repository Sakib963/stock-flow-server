const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { getLogActivities } = require("../../../../utils/activity-logger");
const { FROM, KIND, STATE, OWN_STATE, LOCKED } = require("../utils/feature-sql");

const DETAILS_SQL = `
    SELECT m.oid, m.slug, m.label, m.label_bn, m.description_en, m.description_bn, m.tags, m.icon, m.route, m.permission_code,
           m.is_new, m.is_disabled, m.disabled_message_en, m.disabled_message_bn,
           ${KIND} AS kind, ${STATE} AS state, ${LOCKED} AS locked,
           p.oid AS module_oid, p.label AS module_label, p.label_bn AS module_label_bn,
           ${OWN_STATE} AS own_state,
           p.disabled_message_en AS module_reason_en, p.disabled_message_bn AS module_reason_bn,
           m.created_on, COALESCE(m.edited_on, m.created_on) AS last_action_on,
           COALESCE(m.edited_by, m.created_by) AS last_action_by, u.name AS last_action_by_name
      FROM ${FROM}
     WHERE m.oid = $1`;

// Every action of the feature, with the roles that hold it in this deployment. Grants are made in Roles.
const ACTIONS_SQL = `
    SELECT pm.code, pm.action,
           COALESCE((SELECT json_agg(r.name ORDER BY r.name) FROM ${TABLE.ROLE_PERMISSION} rp JOIN ${TABLE.ROLE} r ON r.oid = rp.role_oid
                      WHERE rp.permission_oid = pm.oid AND r.status = 'Active'), '[]'::json) AS roles
      FROM ${TABLE.PERMISSION} pm
     WHERE pm.module || '.' || pm.feature = $1
     ORDER BY pm.sort_order, pm.code`;

const FEATURES_SQL = `
    SELECT m.oid, m.label, m.label_bn, m.route, ${STATE} AS state
      FROM ${FROM}
     WHERE m.parent_oid = $1
     ORDER BY m.sort_order`;

const get_feature_details = async (request, res) => {
    const { oid } = request.params;
    try {
        const [details] = await get_data({ text: DETAILS_SQL, values: [oid] });
        if (!details) return res.status(404).json({ code: 404, message: "That feature is not in the registry.", data: null });

        const prefix = details.permission_code ? details.permission_code.slice(0, details.permission_code.lastIndexOf(".")) : null;
        const [actions, features, activity] = await Promise.all([
            prefix ? get_data({ text: ACTIONS_SQL, values: [prefix] }) : [],
            details.kind === "Module" ? get_data({ text: FEATURES_SQL, values: [oid] }) : [],
            getLogActivities("feature", oid, 10),
        ]);

        return res.status(200).json({
            code: 200,
            message: "Feature details",
            data: { details, actions, features, activity: activity.map((a) => ({ oid: a.oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description })) },
        });
    } catch (e) {
        log.error(`An exception occurred while reading feature ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the feature. Try again in a moment." });
    }
};

module.exports = get_feature_details;
