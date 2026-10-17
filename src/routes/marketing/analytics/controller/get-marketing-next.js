const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { business_day, business_day_start, business_today } = require("../../../../utils/business-time");
const { channels_of } = require("../../../sales/utils/channels");
const { read_period } = require("../../../sales/analytics/utils/kept-sales");
const { read_arrivals } = require("../../../sales/analytics/utils/team");
const { sees_money } = require("../../../inventory/utils/sees-money");
const { campaign_results } = require("../utils/campaign-results");
const { read_comparisons } = require("../utils/comparisons");
const { FLOOR } = require("../utils/campaign-result");

// Products some non-cancelled campaign promoted on any day from $from to $to.
const busy = (from, to) => `
    SELECT DISTINCT i.product_oid
      FROM ${TABLE.CAMPAIGN} c JOIN ${TABLE.CAMPAIGN_BATCH} cb ON cb.campaign_oid = c.oid JOIN ${TABLE.INVENTORY} i ON i.oid = cb.inventory_oid
     WHERE c.status <> 'Cancelled' AND c.posting_start <= ${to} AND c.measure_end >= ${from}`;

// Kept units of every product no campaign promoted, in the period up to yesterday and the same number
// of days before it: what REQ-17 sets against the rest of the business. $1, $2 the period, $3 channels.
const UNPROMOTED_SQL = `
    WITH span AS (
        SELECT w_start, w_end, w_start - (w_end - w_start + 1) AS b_start
          FROM (SELECT $1::date AS w_start, LEAST($2::date, ${business_today} - 1) AS w_end) s
         WHERE w_end >= w_start
    ),
    per AS (
        SELECT oi.product_oid,
               COALESCE(SUM(oi.quantity - oi.returned_qty) FILTER (WHERE ${business_day("o.sold_on")} < span.w_start), 0)::int AS units_before,
               COALESCE(SUM(oi.quantity - oi.returned_qty) FILTER (WHERE ${business_day("o.sold_on")} >= span.w_start), 0)::int AS units_window
          FROM ${TABLE.ORDERS} o JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid, span
         WHERE o.sold_on >= ${business_day_start("span.b_start")} AND o.sold_on < ${business_day_start("span.w_end + 1")} AND o.channel = ANY($3)
         GROUP BY oi.product_oid
    )
    SELECT p.oid, p.name, per.units_before, per.units_window
      FROM per JOIN ${TABLE.PRODUCT} p ON p.oid = per.product_oid, span
     WHERE per.product_oid NOT IN (${busy("span.b_start", "span.w_end")})`;

// The category that sold most in the period with none of its products in a campaign, and who bought
// it: an audience no campaign has reached yet (REQ-12). $1, $2 the period, $3 channels.
const AUDIENCE_SQL = `
    WITH sold AS (
        SELECT o.oid AS order_oid, o.customer_oid, p.category_oid,
               (oi.unit_price - COALESCE(oi.discount, 0)) * (oi.quantity - oi.returned_qty) AS sales
          FROM ${TABLE.ORDERS} o JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid
         WHERE o.sold_on >= ${business_day_start("$1")} AND o.sold_on < ${business_day_start("$2::date + 1")} AND o.channel = ANY($3) AND oi.quantity > oi.returned_qty
    ),
    top AS (
        SELECT s.category_oid, SUM(s.sales) AS sales
          FROM sold s
         WHERE NOT EXISTS (SELECT 1 FROM (${busy("$1::date", "$2::date")}) b JOIN ${TABLE.PRODUCT} bp ON bp.oid = b.product_oid WHERE bp.category_oid = s.category_oid)
         GROUP BY s.category_oid ORDER BY 2 DESC, s.category_oid LIMIT 1
    ),
    buyers AS (SELECT DISTINCT s.customer_oid FROM sold s JOIN top ON top.category_oid = s.category_oid WHERE s.customer_oid IS NOT NULL)
    SELECT top.category_oid AS oid, c.name, top.sales::float AS sales,
           (SELECT COUNT(*) FROM buyers)::int AS buyers,
           (SELECT COALESCE(json_agg(x ORDER BY x.customers DESC, x.age_band), '[]'::json) FROM (
                SELECT cu.age_band, COUNT(*)::int AS customers FROM buyers b JOIN ${TABLE.CUSTOMERS} cu ON cu.oid = b.customer_oid
                 WHERE cu.age_band IS NOT NULL GROUP BY cu.age_band) x) AS ages,
           (SELECT COALESCE(json_agg(x ORDER BY x.orders DESC, x.name_en), '[]'::json) FROM (
                SELECT d.oid, d.name_en, d.name_bn, COUNT(DISTINCT s.order_oid)::int AS orders
                  FROM sold s JOIN top t ON t.category_oid = s.category_oid
                  JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = s.order_oid JOIN ${TABLE.DISTRICT} d ON d.oid = oo.district_oid
                 GROUP BY d.oid, d.name_en, d.name_bn ORDER BY 4 DESC, 2 LIMIT 3) x) AS districts
      FROM top JOIN ${TABLE.CATEGORIES} c ON c.oid = top.category_oid`;

const rising_of = (rows) => {
    const total_before = rows.reduce((sum, r) => sum + r.units_before, 0);
    const total_window = rows.reduce((sum, r) => sum + r.units_window, 0);
    return rows
        .filter((r) => r.units_before >= FLOOR && r.units_window >= FLOOR && total_before - r.units_before > 0)
        .map((r) => {
            const expected = r.units_before * ((total_window - r.units_window) / (total_before - r.units_before));
            // Rounded only to show, as judge does, so a product and a campaign are called rising alike.
            return { oid: r.oid, name: r.name, units_before: r.units_before, units_window: r.units_window, expected: Math.round(expected), extra: Math.round(r.units_window - expected), raw: r.units_window - expected };
        })
        .filter((r) => r.raw > 0)
        .sort((a, b) => b.raw - a.raw || a.name.localeCompare(b.name))
        .slice(0, 3)
        .map(({ raw, ...r }) => r);
};

// Nothing when no campaign has paid yet: a best return below the cost is not a recommendation.
const best_of = (rows) => rows.filter((r) => r.paid > 0).sort((a, b) => b.paid - a.paid || (b.return_per_taka ?? -1) - (a.return_per_taka ?? -1) || b.first_time - a.first_time)[0];

const arrivals_of = (rows) => {
    const total = rows.reduce((sum, r) => sum + r.orders, 0);
    if (total < FLOOR) return null;
    const busiest = (key) => {
        const counts = new Map();
        rows.forEach((r) => counts.set(r[key], (counts.get(r[key]) ?? 0) + r.orders));
        const [value, orders] = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
        return { value, orders };
    };
    const weekday = busiest("weekday");
    const hour = busiest("hour");
    return { total, weekday: weekday.value, weekday_orders: weekday.orders, hour: hour.value, hour_orders: hour.orders };
};

const audience_of = (row) => {
    if (!row) return null;
    const known = row.ages.reduce((sum, a) => sum + a.customers, 0);
    const top = known >= FLOOR ? row.ages[0] : null;
    return { category: { oid: row.oid, name: row.name }, sales: row.sales, buyers: row.buyers, known, age_band: top?.age_band ?? null, age_share: top ? Math.round((top.customers / known) * 100) : null, districts: row.districts };
};

const get_marketing_next = async (request, res) => {
    const { date_from, date_to, channel } = request.query;
    try {
        const held = await channels_of(request);
        const channels = channel ? held.filter((c) => c === channel) : held;
        const [period, money_shown] = await Promise.all([read_period(date_from, date_to), sees_money(request)]);
        const values = [period.date_from, period.date_to, channels];
        const [unpromoted, audience, arrivals, results] = await Promise.all([
            get_data({ text: UNPROMOTED_SQL, values }),
            get_data({ text: AUDIENCE_SQL, values }),
            read_arrivals(period.date_from, period.date_to, channels),
            campaign_results(period, channels, money_shown),
        ]);
        const { types, partners } = await read_comparisons(results, money_shown);

        const rising = rising_of(unpromoted);
        const type = best_of(types);
        const partner = best_of(partners);
        const reached = audience_of(audience[0]);
        const busy_times = arrivals_of(arrivals);
        const suggestions = [
            rising.length && { kind: "rising", products: rising, floor: FLOOR },
            type && { kind: "type", promotion_type: type.promotion_type, paid: type.paid, campaigns: type.campaigns, return_per_taka: type.return_per_taka },
            partner && { kind: "partner", oid: partner.oid, name: partner.name, paid: partner.paid, campaigns: partner.campaigns, return_per_taka: partner.return_per_taka },
            reached && { kind: "audience", ...reached, floor: FLOOR },
            busy_times && { kind: "arrivals", ...busy_times },
        ].filter(Boolean);

        return res.status(200).json({ code: 200, message: "What next", data: { period, suggestions } });
    } catch (e) {
        log.error(`An exception occurred while writing what to promote next: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not work out what to promote next. Try again in a moment." });
    }
};

module.exports = get_marketing_next;
