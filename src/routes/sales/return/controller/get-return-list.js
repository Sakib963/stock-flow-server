const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { business_day } = require("../../../../utils/business-time");
const { channels_of } = require("../../utils/channels");
const { LIST, STATS } = require("../utils/return-list");

// Returns of orders in the person's channels only (sales REQ-02).
const get_return_list = async (request, res) => {
    try {
        const { query } = request;
        const where = ["o.channel = ANY($1)"];
        const values = [await channels_of(request)];
        if (query.date_from) {
            values.push(query.date_from);
            where.push(`${business_day("pr.created_on")} >= $${values.length}::date`);
        }
        if (query.date_to) {
            values.push(query.date_to);
            where.push(`${business_day("pr.created_on")} <= $${values.length}::date`);
        }
        const { rows, total, stats } = await read_list({ ...LIST, where, values, stats: STATS, query });
        return res.status(200).json({ code: 200, message: "Returns", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing returns: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the returns. Try again in a moment." });
    }
};

module.exports = get_return_list;
