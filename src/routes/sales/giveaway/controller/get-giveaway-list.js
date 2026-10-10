const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { business_day } = require("../../../../utils/business-time");
const { sees_money } = require("../../../inventory/utils/sees-money");
const { LIST, STATS } = require("../utils/giveaway-list");

// Cost is field level money (giveaway REQ-08): left out for someone without inventory.stock-value.view.
const get_giveaway_list = async (request, res) => {
    try {
        const { query } = request;
        const where = [];
        const values = [];
        if (query.date_from) {
            values.push(query.date_from);
            where.push(`${business_day("g.created_on")} >= $${values.length}::date`);
        }
        if (query.date_to) {
            values.push(query.date_to);
            where.push(`${business_day("g.created_on")} <= $${values.length}::date`);
        }
        const { rows, total, stats } = await read_list({ ...LIST, where, values, stats: STATS, query });
        if (!(await sees_money(request))) {
            for (const row of rows) delete row.cost;
            if (stats) delete stats.cost_this_month;
        }
        return res.status(200).json({ code: 200, message: "Giveaways", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing giveaways: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the giveaways. Try again in a moment." });
    }
};

module.exports = get_giveaway_list;
