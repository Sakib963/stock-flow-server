const { getSettings } = require("../../../../utils/settings-cache");
const { log } = require("../../../../utils/log");

// Only what the settings page shows and saves, never the rest of the row.
const get_settings = async (request, res) => {
    try {
        const row = (await getSettings()) || {};
        const data = {
            name: row.name ?? null,
            logo_url: row.logo_url ?? null,
            address: row.address ?? null,
            phone_primary: row.phone_primary ?? null,
            phone_secondary: row.phone_secondary ?? null,
            website: row.website ?? null,
            facebook_url: row.facebook_url ?? null,
            instagram_url: row.instagram_url ?? null,
            edited_on: row.edited_on ?? null,
            edited_by: row.edited_by ?? null,
        };
        return res.status(200).json({ code: 200, message: "Settings", data });
    } catch (e) {
        log.error(`An exception occurred while getting settings: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the business settings. Try again in a moment." });
    }
};

module.exports = get_settings;
