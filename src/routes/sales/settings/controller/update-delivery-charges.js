const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { bump_config_version } = require("../../../../utils/config-version");
const { invalidateSettings } = require("../../../../utils/settings-cache");
const { invalidate_location_index } = require("../../location/utils/location-index");
const { log } = require("../../../../utils/log");

// The two delivery charges an online order is suggested from, and the district they are measured
// from (sales REQ-39). Each order's charge can still be changed on the order.
const update_delivery_charges = async (request, res) => {
    const { home_district_oid, delivery_charge_inside, delivery_charge_outside } = request.body;
    try {
        const saved = await execute_transaction(async (tx) => {
            const [district] = await tx.get_data({ text: `SELECT oid, name_en, name_bn FROM ${TABLE.DISTRICT} WHERE oid = $1 AND status = 'Active'`, values: [home_district_oid] });
            if (!district) fail(400, "That district is not in the list. Pick it again.", { field: "home_district_oid" });

            const updated = await tx.execute_value({
                text: `UPDATE ${TABLE.SETTINGS}
                          SET home_district_oid = $1, delivery_charge_inside = $2, delivery_charge_outside = $3, edited_by = $4, edited_on = clock_timestamp()
                        WHERE oid = (SELECT oid FROM ${TABLE.SETTINGS} ORDER BY created_on LIMIT 1)
                    RETURNING oid`,
                values: [home_district_oid, delivery_charge_inside, delivery_charge_outside, request.credentials.user_id],
            });
            if (updated.rowCount !== 1) fail(409, "The business settings are missing. Ask support to set them up.");

            await bump_config_version(tx);
            await saveLogActivity({ reference_type: "settings", reference_oid: updated.rows[0].oid, title: "Updated delivery charges", description: `${district.name_en}: ${delivery_charge_inside} inside, ${delivery_charge_outside} outside` }, { tx, request });
            return { home_district: district, delivery_charge_inside, delivery_charge_outside };
        });

        invalidateSettings();
        // On a new install the home district stands in for the most common one when ranking places.
        invalidate_location_index();
        return res.status(200).json({ code: 200, message: "Delivery charges saved", data: saved });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while saving the delivery charges: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The delivery charges were not saved. Try again in a moment." });
    }
};

module.exports = update_delivery_charges;
