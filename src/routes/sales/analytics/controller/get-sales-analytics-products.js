const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");
const { read_period } = require("../utils/kept-sales");
const { read_products } = require("../utils/products");
const { products_insights } = require("../utils/products-insight");

const get_sales_analytics_products = async (request, res) => {
    const { date_from, date_to, channel, source_oid = null, category_oid = null } = request.query;
    try {
        const held = await channels_of(request);
        const channels = channel ? held.filter((c) => c === channel) : held;
        const period = await read_period(date_from, date_to);
        const figures = await read_products(period.date_from, period.date_to, { channels, source_oid, category_oid });
        return res.status(200).json({ code: 200, message: "Products and suppliers", data: { period, ...figures, insights: products_insights(figures) } });
    } catch (e) {
        log.error(`An exception occurred while reading the products and suppliers analytics: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the products and suppliers figures. Try again in a moment." });
    }
};

module.exports = get_sales_analytics_products;
