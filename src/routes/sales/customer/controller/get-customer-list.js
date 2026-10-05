const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { LIST, STATS } = require("../utils/customer-list");
const { channels_of } = require("../../utils/channels");
const { sees_addresses, without_address } = require("../utils/address");

const get_customer_list = async (request, res) => {
    try {
        const channels = await channels_of(request);
        const query = sees_addresses(channels) ? request.query : { ...request.query, district: undefined };
        const list = await read_list({ ...LIST, stats: STATS, query });
        const { total, stats } = list;
        const rows = sees_addresses(channels) ? list.rows : list.rows.map(without_address);
        return res.status(200).json({ code: 200, message: "Customers", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing customers: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load customers. Try again in a moment." });
    }
};

module.exports = get_customer_list;
