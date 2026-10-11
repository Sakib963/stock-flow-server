const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { BY_PRODUCT, BY_PRODUCT_STATS } = require("../utils/pre-order-list");

const get_pre_orders_by_product = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({ ...BY_PRODUCT, where: [], values: [], stats: BY_PRODUCT_STATS, query: request.query });
        return res.status(200).json({ code: 200, message: "Booked products", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing booked products: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the booked products. Try again in a moment." });
    }
};

module.exports = get_pre_orders_by_product;
