const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { FROM, STATE } = require("../../feature/utils/feature-sql");
const { caller_of, is_restricted } = require("../utils/role-grants");

const FEATURES_SQL = `
    SELECT m.oid, m.parent_oid, m.slug, m.label, m.label_bn, m.permission_code, ${STATE} AS state
      FROM ${FROM}
     ORDER BY COALESCE(p.sort_order, m.sort_order), COALESCE(p.oid, m.oid), (m.parent_oid IS NOT NULL), m.sort_order`;

const ACTIONS_SQL = `SELECT code, module, feature, action, label, label_bn, is_sensitive FROM ${TABLE.PERMISSION} ORDER BY sort_order, code`;

// The tree a role is ticked in: only the actions the caller holds, since nobody grants what they do
// not hold. A menu entry with none of them left is dropped by the web.
const get_role_tree = async (request, res) => {
    try {
        const [caller, features, actions] = await Promise.all([caller_of(request), get_data({ text: FEATURES_SQL }), get_data({ text: ACTIONS_SQL })]);
        const held = actions.filter((a) => caller.held.has(a.code)).map((a) => ({ ...a, restricted: is_restricted(a.code) }));
        return res.status(200).json({ code: 200, message: "Role tree", data: { features, actions: held } });
    } catch (e) {
        log.error(`An exception occurred while reading the role tree: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the features. Try again in a moment." });
    }
};

module.exports = get_role_tree;
