const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { bump_config_version } = require("../../../../utils/config-version");
const { invalidateSettings } = require("../../../../utils/settings-cache");
const { log } = require("../../../../utils/log");

// Only the fields the page sends are written; the rest of the row is left as it is. The version bump
// in the same transaction is what makes every server instance's settings cache and every open tab
// take the new name, logo and contact details on its next request.
const update_settings = async (request, res) => {
    const p = request.body;
    const user_id = request.credentials.user_id;
    try {
        const saved = await execute_transaction(async (tx) => {
            const updated = await tx.execute_value({
                text: `UPDATE ${TABLE.SETTINGS}
                          SET name = $1, logo_url = $2, address = $3, phone_primary = $4, phone_secondary = $5,
                              website = $6, facebook_url = $7, instagram_url = $8, edited_by = $9, edited_on = clock_timestamp()
                        WHERE oid = (SELECT oid FROM ${TABLE.SETTINGS} ORDER BY created_on LIMIT 1)
                    RETURNING oid, name, logo_url, address, phone_primary, phone_secondary, website, facebook_url, instagram_url, edited_on, edited_by`,
                values: [p.name, p.logo_url, p.address, p.phone_primary, p.phone_secondary, p.website, p.facebook_url, p.instagram_url, user_id],
            });
            if (updated.rowCount !== 1) fail(409, "The business settings are missing. Ask support to set them up.");
            await bump_config_version(tx);
            const { oid, ...row } = updated.rows[0];
            await saveLogActivity({ reference_type: "settings", reference_oid: oid, title: "Business settings updated", description: `${row.name}: name, logo and contact details` }, { tx, request });
            return row;
        });
        invalidateSettings();
        log.info(`Business settings updated by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Settings saved", data: saved });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while updating settings: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The settings were not saved. Try again in a moment." });
    }
};

module.exports = update_settings;
