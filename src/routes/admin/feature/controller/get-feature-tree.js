const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { FROM, KIND, STATE } = require("../utils/feature-sql");

const FEATURES_SQL = `
    SELECT m.oid, m.parent_oid, m.slug, m.label, m.label_bn, m.route, m.permission_code, ${KIND} AS kind, ${STATE} AS state
      FROM ${FROM}
     ORDER BY COALESCE(p.sort_order, m.sort_order), COALESCE(p.oid, m.oid), (m.parent_oid IS NOT NULL), m.sort_order`;

// Every action the product has. The web hangs each under the feature whose code it starts with, and a
// code with no menu entry of its own (inventory.stock-value) under its module.
const ACTIONS_SQL = `SELECT code, module, feature, action, label, label_bn, is_sensitive FROM ${TABLE.PERMISSION} ORDER BY sort_order, code`;

const get_feature_tree = async (request, res) => {
    try {
        const [features, actions] = await Promise.all([get_data({ text: FEATURES_SQL }), get_data({ text: ACTIONS_SQL })]);
        return res.status(200).json({ code: 200, message: "Feature tree", data: { features, actions } });
    } catch (e) {
        log.error(`An exception occurred while reading the feature tree: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the feature tree. Try again in a moment." });
    }
};

module.exports = get_feature_tree;
