const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { refuse_stale } = require("../../../../db/stale-edit");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { bump_config_version } = require("../../../../utils/config-version");

const FIELDS = { label: "English label", label_bn: "Bengali label", description_en: "English description", description_bn: "Bengali description", tags: "Search tags", is_new: "New badge" };
const shown = (value) => (Array.isArray(value) ? value.join(", ") : value === null || value === "" ? "empty" : String(value));

const update_feature_details = async (request, res) => {
    const payload = request.body;
    let changes = [];
    try {
        await execute_transaction(async (tx) => {
            await refuse_stale(tx, { table: TABLE.MENU_ITEM, oid: payload.oid, version: payload.version, gone: "That feature is not in the registry." });
            const [row] = await tx.get_data({
                text: `SELECT label, label_bn, description_en, description_bn, tags, is_new FROM ${TABLE.MENU_ITEM} WHERE oid = $1 FOR UPDATE`,
                values: [payload.oid],
            });
            if (!row) fail(404, "That feature is not in the registry.");

            changes = Object.keys(FIELDS).filter((field) => shown(row[field]) !== shown(payload[field]));
            if (!changes.length) return;

            await tx.execute_value({
                text: `UPDATE ${TABLE.MENU_ITEM}
                          SET label = $2, label_bn = $3, description_en = $4, description_bn = $5, tags = $6, is_new = $7, edited_by = $8, edited_on = clock_timestamp()
                        WHERE oid = $1`,
                values: [payload.oid, payload.label, payload.label_bn, payload.description_en, payload.description_bn, payload.tags, payload.is_new, request.credentials.user_id],
            });
            // Every open tab reads the menu again on its next request.
            await bump_config_version(tx);
            await saveLogActivity(
                { reference_type: "feature", reference_oid: payload.oid, title: "Updated feature", description: changes.map((f) => `${FIELDS[f]} changed from "${shown(row[f])}" to "${shown(payload[f])}"`).join(", ") },
                { tx, request }
            );
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while updating feature ${payload.oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the feature. Try again in a moment." });
    }

    if (!changes.length) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });
    return res.status(200).json({ code: 200, message: "Feature saved", data: { changed: true } });
};

module.exports = update_feature_details;
