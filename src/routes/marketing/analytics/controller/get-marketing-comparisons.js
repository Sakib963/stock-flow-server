const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { channels_of } = require("../../../sales/utils/channels");
const { read_period } = require("../../../sales/analytics/utils/kept-sales");
const { sees_money } = require("../../../inventory/utils/sees-money");
const { campaign_results } = require("../utils/campaign-results");

// Each partner on the period's campaigns, with their fees and what they delivered (REQ-11).
const PARTNERS_SQL = `
    SELECT pt.oid, pt.name, pt.partner_type, cp.campaign_oid, cp.agreed_fee::float AS fee,
           COUNT(d.oid) FILTER (WHERE d.status = 'Posted')::int AS on_time,
           COUNT(d.oid) FILTER (WHERE d.status = 'Late')::int AS late,
           COUNT(d.oid) FILTER (WHERE d.status = 'Missed')::int AS missed
      FROM ${TABLE.CAMPAIGN_PARTNER} cp
      JOIN ${TABLE.PARTNER} pt ON pt.oid = cp.partner_oid
      LEFT JOIN ${TABLE.CAMPAIGN_DELIVERABLE} d ON d.campaign_partner_oid = cp.oid
     WHERE cp.campaign_oid = ANY($1)
     GROUP BY pt.oid, pt.name, pt.partner_type, cp.campaign_oid, cp.agreed_fee`;

const judged = (r) => r.verdict !== "too_little";
const sum = (rows, pick) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
/** Extra profit for every ৳1, over the campaigns judged with a cost; null when there is nothing to divide or the money is hidden. */
const return_of = (rows, money_shown) => {
    const counted = rows.filter((r) => judged(r) && r.cost > 0);
    const cost = sum(counted, (r) => r.cost);
    return money_shown && cost > 0 ? Math.round((sum(counted, (r) => r.extra_profit) / cost) * 100) / 100 : null;
};

const get_marketing_comparisons = async (request, res) => {
    const { date_from, date_to, channel } = request.query;
    try {
        const held = await channels_of(request);
        const channels = channel ? held.filter((c) => c === channel) : held;
        const [period, money_shown] = await Promise.all([read_period(date_from, date_to), sees_money(request)]);
        const results = await campaign_results(period, channels, money_shown);
        const by_oid = new Map(results.map((r) => [r.oid, r]));

        // Promotion types compared (REQ-10).
        const types = [...new Set(results.map((r) => r.promotion_type))].map((type) => {
            const rows = results.filter((r) => r.promotion_type === type);
            const first_time = sum(rows, (r) => r.first_time);
            const cost = sum(rows, (r) => r.cost);
            return { promotion_type: type, campaigns: rows.length, judged: rows.filter(judged).length, cost, first_time, cost_per_first_time: first_time ? Math.round(cost / first_time) : null, return_per_taka: return_of(rows, money_shown) };
        });

        // Partners compared (REQ-11): a campaign's rise is shared by everyone on it, so it is not split between them.
        const lines = results.length ? await get_data({ text: PARTNERS_SQL, values: [results.map((r) => r.oid)] }) : [];
        const partners = [...new Set(lines.map((l) => l.oid))].map((oid) => {
            const own = lines.filter((l) => l.oid === oid);
            const campaigns = own.map((l) => by_oid.get(l.campaign_oid));
            const rises = campaigns.filter(judged).map((r) => r.extra);
            return {
                oid,
                name: own[0].name,
                partner_type: own[0].partner_type,
                campaigns: own.length,
                fees: sum(own, (l) => l.fee),
                average_extra: rises.length ? Math.round(sum(rises, (n) => n) / rises.length) : null,
                first_time: sum(campaigns, (r) => r.first_time),
                on_time: sum(own, (l) => l.on_time),
                late: sum(own, (l) => l.late),
                missed: sum(own, (l) => l.missed),
                return_per_taka: return_of(campaigns, money_shown),
            };
        });
        partners.sort((a, b) => (b.return_per_taka ?? -1) - (a.return_per_taka ?? -1) || b.first_time - a.first_time || a.name.localeCompare(b.name));
        types.sort((a, b) => (b.return_per_taka ?? -1) - (a.return_per_taka ?? -1) || b.campaigns - a.campaigns);

        return res.status(200).json({ code: 200, message: "Partners and types compared", data: { period, types, partners } });
    } catch (e) {
        log.error(`An exception occurred while comparing partners and promotion types: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not compare the partners and promotion types. Try again in a moment." });
    }
};

module.exports = get_marketing_comparisons;
