const { log } = require("../../../utils/log");
const { permissions_for } = require("../../../middleware/require-permission");
const { channels_of } = require("../../sales/utils/channels");
const { read_dashboard_period } = require("../utils/period");
const { read_attention } = require("../utils/attention");
const { read_for_you } = require("../utils/for-you");
const { read_business, read_stock } = require("../utils/at-a-glance");

// One section failing must not blank the first page anyone sees: it answers its own error and the
// rest still arrive.
const section = async (name, read) => {
    try {
        return await read();
    } catch (e) {
        log.error(`The dashboard could not read ${name}: ${e?.message}`);
        return { failed: true };
    }
};

// The whole dashboard for one period, with only the sections the caller holds a feature for.
const get_dashboard = async (request, res) => {
    const { period: key } = request.query;
    try {
        const user_id = request.credentials.user_id;
        const [held, channels, period] = await Promise.all([permissions_for(user_id), channels_of(request), read_dashboard_period(key)]);

        const [for_you, attention, business, stock] = await Promise.all([
            section("for you", () => read_for_you({ held, user_id, period })),
            section("needs attention", () => read_attention({ held, channels })),
            section("business at a glance", () => read_business({ held, channels, period })),
            section("stock at a glance", () => read_stock({ held })),
        ]);

        return res.status(200).json({ code: 200, message: "Dashboard", data: { period: { key, ...period }, for_you, attention, business, stock } });
    } catch (e) {
        log.error(`An exception occurred while reading the dashboard: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the dashboard. Try again in a moment." });
    }
};

module.exports = get_dashboard;
