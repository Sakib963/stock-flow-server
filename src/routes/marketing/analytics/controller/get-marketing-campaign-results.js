const { log } = require("../../../../utils/log");
const { channels_of } = require("../../../sales/utils/channels");
const { read_period } = require("../../../sales/analytics/utils/kept-sales");
const { sees_money } = require("../../../inventory/utils/sees-money");
const { campaign_results } = require("../utils/campaign-results");

const get_marketing_campaign_results = async (request, res) => {
    const { date_from, date_to, channel } = request.query;
    try {
        const held = await channels_of(request);
        const channels = channel ? held.filter((c) => c === channel) : held;
        const [period, money_shown] = await Promise.all([read_period(date_from, date_to), sees_money(request)]);
        const results = await campaign_results(period, channels, money_shown);
        return res.status(200).json({ code: 200, message: "Campaign results", data: { period, results } });
    } catch (e) {
        log.error(`An exception occurred while working out campaign results: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not work out the campaign results. Try again in a moment." });
    }
};

module.exports = get_marketing_campaign_results;
