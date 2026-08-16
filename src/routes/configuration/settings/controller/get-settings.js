const { getSettings } = require("../../../../utils/settings-cache");
const { log } = require("../../../../utils/log");

// Return the (single) settings row. Served from the in-memory cache, so this does
// not hit the DB on every request.
const get_settings = async (request, res) => {
    try {
        const data = (await getSettings()) || {};
        return res.status(200).json({ code: 200, message: "Settings found", data });
    } catch (e) {
        log.error(`An exception occurred while getting settings: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_settings;
