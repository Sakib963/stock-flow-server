const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { LIST, STATS, READY, OVERDUE } = require("../utils/pre-order-list");

const get_pre_order_list = async (request, res) => {
    try {
        const { query } = request;
        const where = [query.ready === "true" && READY, query.overdue === "true" && OVERDUE].filter(Boolean);
        const { rows, total, stats } = await read_list({ ...LIST, where, values: [], stats: STATS, query });
        return res.status(200).json({ code: 200, message: "Bookings", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing bookings: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the bookings. Try again in a moment." });
    }
};

module.exports = get_pre_order_list;
