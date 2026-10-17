const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");
const { read_period } = require("../utils/kept-sales");
const { read_order_flow } = require("../utils/order-flow");
const { order_flow_insights } = require("../utils/order-flow-insight");

// Online only: someone who does not sell online, or who narrowed the page to the counter, is told
// the section does not apply rather than shown a funnel of nothing (REQ-141).
const get_sales_analytics_orders = async (request, res) => {
    const { date_from, date_to, channel, source_oid = null, category_oid = null } = request.query;
    try {
        const held = await channels_of(request);
        if (!held.includes("ONLINE") || (channel && channel !== "ONLINE")) {
            return res.status(200).json({ code: 200, message: "Online orders", data: { applies: false } });
        }
        const period = await read_period(date_from, date_to);
        const flow = await read_order_flow(period.date_from, period.date_to, { source_oid, category_oid });
        return res.status(200).json({ code: 200, message: "Online orders", data: { applies: true, period, ...flow, insights: order_flow_insights(flow) } });
    } catch (e) {
        log.error(`An exception occurred while reading the online orders analytics: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the online orders figures. Try again in a moment." });
    }
};

module.exports = get_sales_analytics_orders;
