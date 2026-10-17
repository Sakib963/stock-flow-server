const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_today } = require("../../../../utils/business-time");
const { log } = require("../../../../utils/log");
const { channels_of } = require("../../../sales/utils/channels");
const { read_period } = require("../../../sales/analytics/utils/kept-sales");
const { judge, read_result } = require("../utils/campaign-result");
const { sees_money } = require("../../../inventory/utils/sees-money");

// Campaigns whose window meets the period and has begun, with what each cost in all: fees, ad spend,
// other costs and products given at cost. The verdict needs the whole cost to be honest (REQ-06).
const CAMPAIGNS_SQL = `
    SELECT c.oid, c.campaign_no, c.name, c.promotion_type, c.status,
           ((SELECT COALESCE(SUM(cp.agreed_fee), 0) FROM ${TABLE.CAMPAIGN_PARTNER} cp WHERE cp.campaign_oid = c.oid)
            + COALESCE(c.ad_spend, 0) + COALESCE(c.other_cost, 0))::float AS spent,
           (SELECT COALESCE(SUM(gl.quantity * gl.cost_price), 0) FROM ${TABLE.CAMPAIGN_PARTNER} cp JOIN ${TABLE.GIVEAWAY} g ON g.campaign_partner_oid = cp.oid JOIN ${TABLE.GIVEAWAY_LINE} gl ON gl.giveaway_oid = g.oid
             WHERE cp.campaign_oid = c.oid AND g.status = 'Given')::float AS products_given
      FROM ${TABLE.CAMPAIGN} c
     WHERE c.status <> 'Cancelled' AND c.posting_start <= LEAST($2::date, ${business_today} - 1) AND c.measure_end >= $1::date
     ORDER BY c.posting_start DESC, c.campaign_no`;

const get_marketing_campaign_results = async (request, res) => {
    const { date_from, date_to, channel } = request.query;
    try {
        const held = await channels_of(request);
        const channels = channel ? held.filter((c) => c === channel) : held;
        const period = await read_period(date_from, date_to);
        const [campaigns, money_shown] = await Promise.all([get_data({ text: CAMPAIGNS_SQL, values: [period.date_from, period.date_to] }), sees_money(request)]);
        const results = await Promise.all(
            campaigns.map(async ({ spent, products_given, ...campaign }) => {
                const { figures, overlaps } = await read_result(campaign.oid, channels);
                const { products, ...window } = figures;
                // Judged on the whole cost, so the verdict is honest for everyone. Without the buying price
                // permission, the products given and every figure a buying price could be worked back from are left out.
                const result = { ...campaign, ...window, ...judge(figures, spent + products_given), no_cost_recorded: spent + products_given === 0, overlaps };
                return money_shown ? result : { ...result, cost: spent, profit_per_unit: null, extra_profit: null, return_per_taka: null, money_hidden: true };
            })
        );
        return res.status(200).json({ code: 200, message: "Campaign results", data: { period, results } });
    } catch (e) {
        log.error(`An exception occurred while working out campaign results: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not work out the campaign results. Try again in a moment." });
    }
};

module.exports = get_marketing_campaign_results;
