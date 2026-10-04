const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { LIST, STATS } = require("../utils/customer-list");

const get_customer_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({ ...LIST, stats: STATS, query: request.query });
        return res.status(200).json({ code: 200, message: "Customers", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing customers: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load customers. Try again in a moment." });
    }
};

module.exports = get_customer_list;
