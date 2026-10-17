const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day, business_day_start } = require("../../../../utils/business-time");
const { log } = require("../../../../utils/log");
const { channels_of } = require("../../../sales/utils/channels");
const { read_period } = require("../../../sales/analytics/utils/kept-sales");
const { sees_money } = require("../../../inventory/utils/sees-money");

// The sales line with its first-time customers per day (REQ-03), the campaigns whose window meets the
// period, shaded on it, and each posted promise pinned on its day. $1 first day, $2 last day, $3 channels.
const DAILY_SQL = `
    WITH firsts AS (
        SELECT o.customer_oid, MIN(${business_day("o.sold_on")}) AS first_day
          FROM ${TABLE.ORDERS} o
         WHERE o.customer_oid IS NOT NULL AND o.sold_on IS NOT NULL AND o.status <> 'Returned' AND o.channel = ANY($3)
         GROUP BY o.customer_oid
    ),
    sold AS (
        SELECT ${business_day("o.sold_on")} AS day, SUM((oi.unit_price - COALESCE(oi.discount, 0)) * (oi.quantity - oi.returned_qty)) AS sales
          FROM ${TABLE.ORDERS} o JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
         WHERE o.sold_on >= ${business_day_start("$1")} AND o.sold_on < ${business_day_start("$2::date + 1")} AND o.channel = ANY($3)
         GROUP BY 1
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(s.sales, 0)::float AS sales,
           (SELECT COUNT(*) FROM firsts f WHERE f.first_day = d.day)::int AS first_time
      FROM generate_series($1::date, $2::date, interval '1 day') AS g(day)
      CROSS JOIN LATERAL (SELECT g.day::date AS day) d
      LEFT JOIN sold s ON s.day = d.day
     ORDER BY d.day`;

const CAMPAIGNS_SQL = `
    SELECT c.oid, c.campaign_no, c.name, c.promotion_type, c.status,
           to_char(c.posting_start, 'YYYY-MM-DD') AS posting_start, to_char(c.posting_end, 'YYYY-MM-DD') AS posting_end, to_char(c.measure_end, 'YYYY-MM-DD') AS measure_end,
           (SELECT COALESCE(json_agg(json_build_object('day', to_char(d.posted_on, 'YYYY-MM-DD'), 'kind', d.kind, 'quantity', d.quantity, 'partner', pt.name) ORDER BY d.posted_on), '[]'::json)
              FROM ${TABLE.CAMPAIGN_PARTNER} cp JOIN ${TABLE.CAMPAIGN_DELIVERABLE} d ON d.campaign_partner_oid = cp.oid JOIN ${TABLE.PARTNER} pt ON pt.oid = cp.partner_oid
             WHERE cp.campaign_oid = c.oid AND d.posted_on BETWEEN $1::date AND $2::date) AS posted
      FROM ${TABLE.CAMPAIGN} c
     WHERE c.status <> 'Cancelled' AND c.posting_start <= $2::date AND c.measure_end >= $1::date
     ORDER BY c.posting_start, c.campaign_no`;

// What was given away to promote in the period, at cost (REQ-13): to partners for a campaign, and
// as gifts to anyone else. A buying price, so only for someone who may see it.
const GIVEN_SQL = `
    SELECT COALESCE(SUM(gl.quantity * gl.cost_price) FILTER (WHERE g.campaign_partner_oid IS NOT NULL), 0)::float AS to_partners,
           COALESCE(SUM(gl.quantity * gl.cost_price) FILTER (WHERE g.campaign_partner_oid IS NULL), 0)::float AS gifts,
           COALESCE(SUM(gl.quantity), 0)::int AS units
      FROM ${TABLE.GIVEAWAY} g JOIN ${TABLE.GIVEAWAY_LINE} gl ON gl.giveaway_oid = g.oid
     WHERE g.status = 'Given' AND g.given_on >= ${business_day_start("$1")} AND g.given_on < ${business_day_start("$2::date + 1")}`;

const get_marketing_analytics_overview = async (request, res) => {
    const { date_from, date_to, channel } = request.query;
    try {
        const held = await channels_of(request);
        const channels = channel ? held.filter((c) => c === channel) : held;
        const period = await read_period(date_from, date_to);
        const range = [period.date_from, period.date_to];
        const [daily, campaigns, money_shown] = await Promise.all([get_data({ text: DAILY_SQL, values: [...range, channels] }), get_data({ text: CAMPAIGNS_SQL, values: range }), sees_money(request)]);
        const given = money_shown ? (await get_data({ text: GIVEN_SQL, values: range }))[0] : null;
        return res.status(200).json({ code: 200, message: "Marketing overview", data: { period, channels: held, daily, campaigns, given } });
    } catch (e) {
        log.error(`An exception occurred while reading the marketing overview: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the marketing figures. Try again in a moment." });
    }
};

module.exports = get_marketing_analytics_overview;
