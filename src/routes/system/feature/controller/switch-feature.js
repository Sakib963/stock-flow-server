const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { bump_config_version } = require("../../../../utils/config-version");
const { FROM, OWN_STATE, LOCKED } = require("../utils/feature-sql");

const TITLE = { On: "Switched feature on", Disabled: "Disabled feature", Hidden: "Hid feature" };

// Disabled and Hidden both refuse every action of the feature, or of every feature in the module, for
// everyone, from the next request on; Disabled still shows it greyed with the reason. The data stays:
// reports keep reading it.
const switch_feature = async (request, res) => {
    const { oid, state, reason_en = null, reason_bn = null } = request.body;
    let changed = true;
    try {
        await execute_transaction(async (tx) => {
            const [row] = await tx.get_data({
                text: `SELECT m.label, ${OWN_STATE} AS state, ${LOCKED} AS locked
                         FROM ${FROM} WHERE m.oid = $1 FOR UPDATE OF m`,
                values: [oid],
            });
            if (!row) fail(404, "That feature is not in the registry.");
            if (row.locked && state !== "On") fail(409, "The System module cannot be turned off: it is where features are turned back on.");
            if (row.state === state) {
                changed = false;
                return;
            }

            await tx.execute_value({
                text: `UPDATE ${TABLE.MENU_ITEM}
                          SET status = $2, is_disabled = $3, disabled_message_en = $4, disabled_message_bn = $5, edited_by = $6, edited_on = clock_timestamp()
                        WHERE oid = $1`,
                values: [oid, state === "Hidden" ? "Inactive" : "Active", state === "Disabled", state === "Disabled" ? reason_en : null, state === "Disabled" ? reason_bn : null, request.credentials.user_id],
            });
            await bump_config_version(tx);
            await saveLogActivity({ reference_type: "feature", reference_oid: oid, title: TITLE[state], description: state === "Disabled" ? `${row.label}: ${reason_en}` : row.label }, { tx, request });
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while switching feature ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not change the feature. Try again in a moment." });
    }

    if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });
    return res.status(200).json({ code: 200, message: TITLE[state], data: { changed: true } });
};

module.exports = switch_feature;
