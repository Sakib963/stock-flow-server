const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { getSettings } = require("../../../../utils/settings-cache");
const { log } = require("../../../../utils/log");

// What the online order page needs before the first order: where orders come in (REQ-38) and the
// two delivery charges, inside and outside the business's own district (REQ-39).
const get_online_order_setup = async (request, res) => {
    try {
        const [sources, settings] = await Promise.all([get_data({ text: `SELECT oid, platform, name FROM ${TABLE.ORDER_SOURCE} WHERE status = 'Active' ORDER BY name, oid`, values: [] }), getSettings()]);
        const [home] = settings?.home_district_oid ? await get_data({ text: `SELECT oid, name_en, name_bn FROM ${TABLE.DISTRICT} WHERE oid = $1`, values: [settings.home_district_oid] }) : [];
        const data = {
            sources,
            delivery_charge_inside: Number(settings?.delivery_charge_inside ?? 0),
            delivery_charge_outside: Number(settings?.delivery_charge_outside ?? 0),
            home_district: home ?? null,
            // The invoice prints the business's own logo when settings has one.
            logo_url: settings?.invoice_logo_url || settings?.logo_url || null,
        };
        return res.status(200).json({ code: 200, message: "Online order setup found", data });
    } catch (e) {
        log.error(`An exception occurred while reading the online order setup: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not open the online order page. Try again in a moment." });
    }
};

module.exports = get_online_order_setup;
