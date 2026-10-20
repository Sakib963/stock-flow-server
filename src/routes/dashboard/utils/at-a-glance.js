const { get_data } = require("../../../db/database");
const { read_totals, read_daily, read_top_products, read_by_channel } = require("../../sales/analytics/utils/kept-sales");
const { PRODUCT_STOCK } = require("../../inventory/overview/utils/stock-figures");

// The one headline per area; the analytics pages go deep. Sales are the kept sales of sales analytics,
// limited to the channels the person sells through, so the two pages can never disagree.
const read_business = async ({ held, channels, period }) => {
    if (!held.has("sales.analytics.view") || !channels.length) return null;
    const filters = { channels, source_oid: null, category_oid: null };
    const one_day = period.date_from === period.date_to;
    const [current, previous, daily, previous_daily, top, by_channel] = await Promise.all([
        read_totals(period.date_from, period.date_to, filters),
        read_totals(period.previous_from, period.previous_to, filters),
        // One day has no shape to draw, so Today has no chart.
        one_day ? [] : read_daily(period.date_from, period.date_to, filters),
        one_day ? [] : read_daily(period.previous_from, period.previous_to, filters),
        read_top_products(period.date_from, period.date_to, filters),
        channels.length > 1 ? read_by_channel(period.date_from, period.date_to, filters) : [],
    ]);
    const figures = (t) => ({ sales: t.sales, profit: t.sales - t.cost, orders: t.orders, average: t.orders ? t.sales / t.orders : 0 });
    return { current: figures(current), previous: figures(previous), units_without_cost: current.units_without_cost, daily, previous_daily, top, by_channel: by_channel.map(({ channel, sales }) => ({ channel, sales })) };
};

// What the stock on the shelf is worth, as the stock overview totals it: cost of every batch, and what
// the priced batches for sale would bring.
const STOCK_SQL = `
    SELECT COALESCE(SUM(o.stock_value), 0)::float8 AS stock_value, COALESCE(SUM(o.expected_revenue), 0)::float8 AS expected_revenue,
           COALESCE(SUM(o.profit_full), 0)::float8 AS profit_full, COALESCE(SUM(o.unpriced_batches), 0)::int AS unpriced_batches
      FROM ${PRODUCT_STOCK}`;

const read_stock = async ({ held }) => (held.has("inventory.stock-value.view") ? (await get_data({ text: STOCK_SQL }))[0] : null);

module.exports = { read_business, read_stock };
