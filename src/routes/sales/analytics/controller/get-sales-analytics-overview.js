const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");
const { permissions_for } = require("../../../../middleware/require-permission");
const { read_extras } = require("../utils/extras");
const { read_period, read_totals, read_daily, read_refusal, read_sources, read_by_channel } = require("../utils/kept-sales");
const { headline_insight, waterfall_insight } = require("../utils/overview-insight");

const get_sales_analytics_overview = async (request, res) => {
    const { date_from, date_to, channel, source_oid = null, category_oid = null } = request.query;
    try {
        const held = await channels_of(request);
        const channels = channel ? held.filter((c) => c === channel) : held;
        const filters = { channels, source_oid, category_oid };
        const period = await read_period(date_from, date_to);

        const [current, previous, daily] = await Promise.all([read_totals(period.date_from, period.date_to, filters), read_totals(period.previous_from, period.previous_to, filters), read_daily(period.date_from, period.date_to, filters)]);

        // Refusal is an online figure: a counter-only person never gets it (REQ-141).
        const online = channels.includes("ONLINE");
        const [refusal, previous_refusal] = online ? await Promise.all([read_refusal(period.date_from, period.date_to, filters), read_refusal(period.previous_from, period.previous_to, filters)]) : [null, null];

        // Pre-orders only for someone who may see them; the counter only for someone who sells there.
        const [extras, held_permissions] = await Promise.all([read_extras(period.date_from, period.date_to, filters), permissions_for(request.credentials.user_id)]);
        const pre_orders = held_permissions.has("sales.pre-order.view") ? extras.pre_orders : null;
        const counter = channels.includes("POS") ? extras.counter : null;

        // Side by side only when both channels are in the figures: one channel needs no split.
        const by_channel = channels.length > 1 ? await read_by_channel(period.date_from, period.date_to, filters) : null;

        // Sources are an online fact, so only someone who sells online is offered them.
        const sources = held.includes("ONLINE") ? await read_sources() : [];

        const tile = (pick) => ({ current: pick(current), previous: pick(previous) });
        return res.status(200).json({
            code: 200,
            message: "Sales overview",
            data: {
                period,
                channels: held,
                sources,
                tiles: {
                    sales: tile((t) => t.sales),
                    profit: tile((t) => t.sales - t.cost),
                    orders: tile((t) => t.orders),
                    margin: tile((t) => (t.sales > 0 ? (t.sales - t.cost) / t.sales : null)),
                    refusal: online ? { current: refusal, previous: previous_refusal } : null,
                },
                daily,
                by_channel,
                pre_orders,
                counter,
                waterfall: { list_price: current.list_price, discounts: current.discounts, returns: current.returns, cost: current.cost, profit: current.sales - current.cost, units_without_cost: current.units_without_cost },
                insights: { headline: headline_insight(current, previous), waterfall: waterfall_insight(current) },
            },
        });
    } catch (e) {
        log.error(`An exception occurred while reading the sales overview: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the sales overview. Try again in a moment." });
    }
};

module.exports = get_sales_analytics_overview;
