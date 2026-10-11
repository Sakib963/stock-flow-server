const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { LIST, STATS } = require("../utils/batch-list");

const get_delivery_batch_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({ ...LIST, where: [], values: [], stats: STATS, query: request.query });
        return res.status(200).json({ code: 200, message: "Delivery batches", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing delivery batches: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the delivery batches. Try again in a moment." });
    }
};

module.exports = get_delivery_batch_list;
