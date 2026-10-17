const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// Active partners only: an inactive one stays on the campaigns it was on, but is not offered for new ones.
const get_partners_for_campaign = async (request, res) => {
    try {
        const rows = await get_data({ text: `SELECT oid, name, partner_type, platforms, handle FROM ${TABLE.PARTNER} WHERE status = 'Active' ORDER BY name`, values: [] });
        return res.status(200).json({ code: 200, message: "Partners", data: rows });
    } catch (e) {
        log.error(`An exception occurred while listing partners for a campaign: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the partners. Try again in a moment." });
    }
};

module.exports = get_partners_for_campaign;
