const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");
const { sees_money } = require("../../../inventory/utils/sees-money");

const FEES = `(SELECT COALESCE(SUM(cp.agreed_fee), 0) FROM ${TABLE.CAMPAIGN_PARTNER} cp WHERE cp.campaign_oid = c.oid)`;

const LIST = {
    select: `c.oid, c.campaign_no, c.name, c.promotion_type, c.status, to_char(c.posting_start, 'YYYY-MM-DD') AS posting_start, to_char(c.posting_end, 'YYYY-MM-DD') AS posting_end,
             to_char(c.measure_end, 'YYYY-MM-DD') AS measure_end, c.created_on,
             (SELECT COUNT(*)::int FROM ${TABLE.CAMPAIGN_PARTNER} cp WHERE cp.campaign_oid = c.oid) AS partners,
             (${FEES} + COALESCE(c.ad_spend, 0) + COALESCE(c.other_cost, 0))::bigint AS agreed_cost,
             (SELECT COALESCE(SUM(gl.quantity * gl.cost_price), 0) FROM ${TABLE.GIVEAWAY} g JOIN ${TABLE.CAMPAIGN_PARTNER} cp ON cp.oid = g.campaign_partner_oid
                JOIN ${TABLE.GIVEAWAY_LINE} gl ON gl.giveaway_oid = g.oid WHERE cp.campaign_oid = c.oid AND g.status = 'Given')::bigint AS products_cost`,
    from: `${TABLE.CAMPAIGN} c`,
    search: ["c.campaign_no", "c.name"],
    filters: { status: "c.status", promotion_type: "c.promotion_type" },
    sortable: { posting_start: "c.posting_start", campaign_no: "c.campaign_no", name: "c.name", created_on: "c.created_on" },
    default_sort: { key: "posting_start", order: "desc" },
    tie_breaker: "c.oid",
};

const STATS = {
    planned: `COUNT(*) FILTER (WHERE c.status = 'Planned')::int`,
    live: `COUNT(*) FILTER (WHERE c.status = 'Live')::int`,
    completed: `COUNT(*) FILTER (WHERE c.status = 'Completed')::int`,
};

const get_campaign_list = async (request, res) => {
    try {
        const [{ rows: raw, total, stats }, money_shown] = await Promise.all([read_list({ ...LIST, stats: STATS, query: request.query }), sees_money(request)]);
        // As on the record: products given count in the agreed cost only for someone who may see buying prices.
        const rows = raw.map(({ products_cost, ...row }) => (money_shown ? { ...row, agreed_cost: Number(row.agreed_cost) + Number(products_cost) } : row));
        return res.status(200).json({ code: 200, message: "Campaigns", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing campaigns: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the campaigns. Try again in a moment." });
    }
};

module.exports = get_campaign_list;
