const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { business_day } = require("../../../../utils/business-time");
const { channels_of } = require("../../utils/channels");
const { LIST, STATS } = require("../utils/order-list");

// The orders list (sales REQ-02): only the person's channels, never a draft. "Mine" is what the
// person placed themselves, so a salesperson opens the list on their own invoices.
const get_order_list = async (request, res) => {
    try {
        const { query } = request;
        const channels = await channels_of(request);
        const where = ["o.channel = ANY($1)", "o.status <> 'Draft'"];
        const values = [channels];
        if (query.mine) {
            values.push(request.credentials.user_id);
            where.push(`o.created_by = $${values.length}`);
        }
        if (query.date_from) {
            values.push(query.date_from);
            where.push(`${business_day("o.created_on")} >= $${values.length}::date`);
        }
        if (query.date_to) {
            values.push(query.date_to);
            where.push(`${business_day("o.created_on")} <= $${values.length}::date`);
        }
        const { rows, total, stats } = await read_list({ ...LIST, where, values, stats: STATS, query });
        return res.status(200).json({ code: 200, message: "Orders", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing orders: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the orders. Try again in a moment." });
    }
};

module.exports = get_order_list;
