const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { bump_config_version } = require("../../../../utils/config-version");

// A move stays within its own level: a feature never changes module, because its permission code
// names the module, and the switched-off check reads it from there.
const reorder_features = async (request, res) => {
    const { groups } = request.body;
    let changed = 0;
    try {
        await execute_transaction(async (tx) => {
            for (const { parent_oid, oids } of groups) {
                const rows = await tx.get_data({
                    text: `SELECT oid, label, sort_order FROM ${TABLE.MENU_ITEM} WHERE parent_oid IS NOT DISTINCT FROM $1 ORDER BY sort_order FOR UPDATE`,
                    values: [parent_oid],
                });
                const current = new Map(rows.map((r) => [r.oid, r]));
                if (rows.length !== oids.length || oids.some((oid) => !current.has(oid))) fail(409, "The menu changed while you were arranging it. Reload it and try again.");

                let moved = false;
                for (const [index, oid] of oids.entries()) {
                    const position = (index + 1) * 10;
                    if (current.get(oid).sort_order === position) continue;
                    await tx.execute_value({ text: `UPDATE ${TABLE.MENU_ITEM} SET sort_order = $2, edited_by = $3, edited_on = clock_timestamp() WHERE oid = $1`, values: [oid, position, request.credentials.user_id] });
                    moved = true;
                }
                if (!moved) continue;
                changed++;
                await saveLogActivity(
                    { reference_type: "feature", reference_oid: parent_oid ?? "menu", title: "Reordered the menu", description: oids.map((oid) => current.get(oid).label).join(", ").slice(0, 500) },
                    { tx, request }
                );
            }
            if (changed) await bump_config_version(tx);
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while reordering the menu: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the order. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: changed ? "Order saved" : "Nothing changed.", data: { changed: changed > 0 } });
};

module.exports = reorder_features;
