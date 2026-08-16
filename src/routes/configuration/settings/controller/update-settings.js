const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { primeSettings } = require("../../../../utils/settings-cache");
const { log } = require("../../../../utils/log");

// Empty string -> NULL so optional fields can be cleared.
const nz = (v) => (v === undefined || v === "" ? null : v);

// Update the single settings row and prime the cache with the fresh values.
const update_settings = async (request, res) => {
    const p = request.body;
    const user_id = request.credentials.user_id;
    try {
        const existing = await get_data({ text: `SELECT oid FROM ${TABLE.SETTINGS} ORDER BY created_on ASC LIMIT 1`, values: [] });
        const oid = existing.length ? existing[0].oid : uuidv4();

        // Should already be seeded, but stay robust if the row is missing.
        if (!existing.length) {
            await execute_value({ text: `INSERT INTO ${TABLE.SETTINGS} (oid, created_by) VALUES ($1, $2)`, values: [oid, user_id] });
        }

        await execute_value({
            text: `UPDATE ${TABLE.SETTINGS} SET
                     name=$1, legal_name=$2, logo_url=$3, address=$4, phone_primary=$5, phone_secondary=$6,
                     email=$7, website=$8, bin=$9, tin=$10, trade_license=$11, bank_details=$12,
                     bkash_number=$13, nagad_number=$14, facebook_url=$15, instagram_url=$16, invoice_footer=$17,
                     default_delivery_charge=$18, order_system=$19, edited_by=$20, edited_on=NOW()
                   WHERE oid=$21`,
            values: [
                nz(p.name), nz(p.legal_name), nz(p.logo_url), nz(p.address), nz(p.phone_primary), nz(p.phone_secondary),
                nz(p.email), nz(p.website), nz(p.bin), nz(p.tin), nz(p.trade_license), nz(p.bank_details),
                nz(p.bkash_number), nz(p.nagad_number), nz(p.facebook_url), nz(p.instagram_url), nz(p.invoice_footer),
                Number(p.default_delivery_charge || 0), p.order_system || "both", user_id, oid,
            ],
        });

        const rows = await get_data({ text: `SELECT * FROM ${TABLE.SETTINGS} WHERE oid = $1`, values: [oid] });
        const updated = rows.length ? rows[0] : null;
        primeSettings(updated);

        saveLogActivity({ reference_type: "settings", reference_oid: oid, title: "Settings Updated", description: "Business settings updated", performed_by: user_id });
        log.info(`Settings updated by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Settings updated successfully!", data: updated });
    } catch (e) {
        log.error(`An exception occurred while updating settings: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = update_settings;
