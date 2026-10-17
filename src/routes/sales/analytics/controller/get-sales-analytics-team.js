const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");
const { read_period } = require("../utils/kept-sales");
const { read_team } = require("../utils/team");
const { team_insights } = require("../utils/team-insight");

const get_sales_analytics_team = async (request, res) => {
    const { date_from, date_to, channel, source_oid = null, category_oid = null } = request.query;
    try {
        const held = await channels_of(request);
        const channels = channel ? held.filter((c) => c === channel) : held;
        const period = await read_period(date_from, date_to);
        const team = await read_team(period.date_from, period.date_to, { channels, source_oid, category_oid });
        return res.status(200).json({ code: 200, message: "Timing and people", data: { period, channels, ...team, insights: team_insights(team) } });
    } catch (e) {
        log.error(`An exception occurred while reading the timing and people analytics: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the timing and people figures. Try again in a moment." });
    }
};

module.exports = get_sales_analytics_team;
