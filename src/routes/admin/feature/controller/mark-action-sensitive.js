const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { bump_config_version } = require("../../../../utils/config-version");

// Sensitive ships with the release; a deployment may judge an action differently. Saving a role that
// gains a sensitive action asks first, so the mark changes what the role form warns about.
const mark_action_sensitive = async (request, res) => {
    const { code, is_sensitive } = request.body;
    try {
        await execute_transaction(async (tx) => {
            const [action] = await tx.get_data({ text: `SELECT label, action, is_sensitive FROM ${TABLE.PERMISSION} WHERE code = $1 FOR UPDATE`, values: [code] });
            if (!action) fail(404, "That action does not exist. Reload the page.");
            if (action.is_sensitive === is_sensitive) return;

            await tx.execute_value({ text: `UPDATE ${TABLE.PERMISSION} SET is_sensitive = $2 WHERE code = $1`, values: [code, is_sensitive] });
            await bump_config_version(tx);
            const [menu] = await tx.get_data({ text: `SELECT oid FROM ${TABLE.MENU_ITEM} WHERE permission_code LIKE $1 || '.%' LIMIT 1`, values: [code.slice(0, code.lastIndexOf("."))] });
            await saveLogActivity(
                { reference_type: "feature", reference_oid: menu?.oid ?? code, title: is_sensitive ? "Marked action sensitive" : "Marked action not sensitive", description: `${action.label}: ${action.action}` },
                { tx, request }
            );
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while marking ${code} sensitive: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the change. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: is_sensitive ? "Marked sensitive" : "Marked not sensitive", data: { code, is_sensitive } });
};

module.exports = mark_action_sensitive;
