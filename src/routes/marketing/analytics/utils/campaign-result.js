const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day, business_day_start, business_today } = require("../../../../utils/business-time");

// Under this many units of the promoted products in either window, nothing is judged (REQ-06),
// the same floor as sales analytics.
const FLOOR = 20;

// How one campaign did, measured against the rest of the business (marketing analytics REQ-04 to
// REQ-08, REQ-15; "How a campaign's result is worked out"). The window is the campaign's measuring
// window, cut at yesterday while it runs so only whole days are compared; the window before is the same number of days just before it.
// Sales are kept units at the line formula, dated by sold_on on the business's calendar.
//
// $1 campaign, $2 channels.
const RESULT_SQL = `
    WITH win AS (
        SELECT c.oid, c.posting_start AS w_start, LEAST(c.measure_end, ${business_today} - 1) AS w_end, c.measure_end >= ${business_today} AS so_far
          FROM ${TABLE.CAMPAIGN} c WHERE c.oid = $1
    ),
    span AS (
        SELECT *, (w_start - (w_end - w_start + 1)) AS b_start FROM win
    ),
    promoted AS (
        SELECT DISTINCT i.product_oid FROM ${TABLE.CAMPAIGN_BATCH} cb JOIN ${TABLE.INVENTORY} i ON i.oid = cb.inventory_oid WHERE cb.campaign_oid = $1
    ),
    -- Every product some campaign promoted in either window, so the rest of the business is unpromoted.
    busy AS (
        SELECT DISTINCT i.product_oid
          FROM ${TABLE.CAMPAIGN} c2 JOIN ${TABLE.CAMPAIGN_BATCH} cb ON cb.campaign_oid = c2.oid JOIN ${TABLE.INVENTORY} i ON i.oid = cb.inventory_oid, span
         WHERE c2.status <> 'Cancelled' AND c2.posting_start <= span.w_end AND c2.measure_end >= span.b_start
    ),
    lines AS (
        SELECT oi.product_oid, o.customer_oid,
               CASE WHEN ${business_day("o.sold_on")} >= span.w_start THEN 'W' ELSE 'B' END AS part,
               (oi.quantity - oi.returned_qty) AS units,
               (oi.unit_price - COALESCE(oi.discount, 0)) * (oi.quantity - oi.returned_qty) AS sales,
               (oi.unit_price - COALESCE(oi.discount, 0) - COALESCE(i.cost_price, 0)) * (oi.quantity - oi.returned_qty) AS profit
          FROM ${TABLE.ORDERS} o
          JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
          LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = oi.inventory_oid, span
         WHERE o.sold_on >= ${business_day_start("span.b_start")} AND o.sold_on < ${business_day_start("span.w_end + 1")}
           AND o.channel = ANY($2)
    ),
    firsts AS (
        SELECT o.customer_oid, MIN(${business_day("o.sold_on")}) AS first_day
          FROM ${TABLE.ORDERS} o
         WHERE o.customer_oid IS NOT NULL AND o.sold_on IS NOT NULL AND o.status <> 'Returned' AND o.channel = ANY($2)
         GROUP BY o.customer_oid
    )
    SELECT to_char(span.w_start, 'YYYY-MM-DD') AS window_from, to_char(span.w_end, 'YYYY-MM-DD') AS window_to,
           to_char(span.b_start, 'YYYY-MM-DD') AS before_from, to_char(span.w_start - 1, 'YYYY-MM-DD') AS before_to,
           (span.w_end - span.w_start + 1)::int AS days, span.so_far,
           (SELECT COALESCE(json_agg(json_build_object('oid', p.oid, 'name', p.name,
                       'units_before', COALESCE((SELECT SUM(units) FROM lines l WHERE l.product_oid = p.oid AND l.part = 'B'), 0),
                       'units_window', COALESCE((SELECT SUM(units) FROM lines l WHERE l.product_oid = p.oid AND l.part = 'W'), 0),
                       'profit_window', COALESCE((SELECT SUM(profit) FROM lines l WHERE l.product_oid = p.oid AND l.part = 'W'), 0)) ORDER BY p.name), '[]'::json)
              FROM promoted pr JOIN ${TABLE.PRODUCT} p ON p.oid = pr.product_oid) AS products,
           (SELECT COALESCE(SUM(units) FILTER (WHERE part = 'B'), 0) FROM lines WHERE product_oid NOT IN (SELECT product_oid FROM busy))::int AS rest_before,
           (SELECT COALESCE(SUM(units) FILTER (WHERE part = 'W'), 0) FROM lines WHERE product_oid NOT IN (SELECT product_oid FROM busy))::int AS rest_window,
           (SELECT COALESCE(SUM(sales) FILTER (WHERE part = 'B'), 0) FROM lines)::float AS business_before,
           (SELECT COALESCE(SUM(sales) FILTER (WHERE part = 'W'), 0) FROM lines)::float AS business_window,
           (SELECT COUNT(*) FROM firsts f WHERE f.first_day BETWEEN span.w_start AND span.w_end)::int AS first_time,
           (SELECT COUNT(*) FROM firsts f WHERE f.first_day BETWEEN span.w_start AND span.w_end
               AND EXISTS (SELECT 1 FROM lines l WHERE l.customer_oid = f.customer_oid AND l.part = 'W' AND l.units > 0 AND l.product_oid IN (SELECT product_oid FROM promoted)))::int AS first_time_promoted
      FROM span`;

// Other campaigns whose window meets this one's and that promote one of its products (REQ-08).
const OVERLAPS_SQL = `
    SELECT c2.oid, c2.campaign_no, c2.name,
           (LEAST(c.measure_end, c2.measure_end, ${business_today} - 1) - GREATEST(c.posting_start, c2.posting_start) + 1)::int AS days,
           json_agg(DISTINCT p.name) AS products
      FROM ${TABLE.CAMPAIGN} c
      JOIN ${TABLE.CAMPAIGN} c2 ON c2.oid <> c.oid AND c2.status <> 'Cancelled' AND c2.posting_start <= c.measure_end AND c2.measure_end >= c.posting_start
      JOIN ${TABLE.CAMPAIGN_BATCH} b2 ON b2.campaign_oid = c2.oid JOIN ${TABLE.INVENTORY} i2 ON i2.oid = b2.inventory_oid
      JOIN ${TABLE.CAMPAIGN_BATCH} b1 ON b1.campaign_oid = c.oid JOIN ${TABLE.INVENTORY} i1 ON i1.oid = b1.inventory_oid AND i1.product_oid = i2.product_oid
      JOIN ${TABLE.PRODUCT} p ON p.oid = i2.product_oid
     WHERE c.oid = $1
     GROUP BY c2.oid, c2.campaign_no, c2.name, c.measure_end, c2.measure_end, c.posting_start, c2.posting_start
     ORDER BY c2.campaign_no`;

// A promoted product that sold nothing in the window before is named and left out (REQ-15).
const judge = (figures, cost) => {
    const judged = figures.products.filter((p) => Number(p.units_before) > 0);
    const not_judged = figures.products.filter((p) => Number(p.units_before) === 0).map((p) => p.name);
    const before = judged.reduce((sum, p) => sum + Number(p.units_before), 0);
    const window = judged.reduce((sum, p) => sum + Number(p.units_window), 0);
    const profit_window = judged.reduce((sum, p) => sum + Number(p.profit_window), 0);
    const base = { floor: FLOOR, promoted_before: before, promoted_window: window, rest_before: figures.rest_before, rest_window: figures.rest_window, not_judged, cost };

    if (figures.rest_before === 0) return { ...base, verdict: "too_little", reason: "no_rest" };
    if (before < FLOOR || window < FLOOR) return { ...base, verdict: "too_little", reason: "few_units" };

    const trend = figures.rest_window / figures.rest_before;
    const expected = before * trend;
    const extra = window - expected;
    const profit_per_unit = window > 0 ? profit_window / window : 0;
    const extra_profit = extra * profit_per_unit;
    const verdict = extra <= 0 ? "no_rise" : extra_profit >= cost ? "paid" : "rose_not_paid";
    const round = (n) => Math.round(n);
    return {
        ...base,
        verdict,
        trend_percent: round((trend - 1) * 100),
        expected: round(expected),
        extra: round(extra),
        profit_per_unit: round(profit_per_unit),
        extra_profit: round(extra_profit),
        // Only when there is a rise and a cost: no ratio is invented for a fall or a free campaign.
        return_per_taka: extra > 0 && cost > 0 ? Math.round((extra_profit / cost) * 100) / 100 : null,
    };
};

const read_result = async (campaign_oid, channels) => {
    const [[figures], overlaps] = await Promise.all([get_data({ text: RESULT_SQL, values: [campaign_oid, channels] }), get_data({ text: OVERLAPS_SQL, values: [campaign_oid] })]);
    return { figures, overlaps };
};

module.exports = { FLOOR, judge, read_result };
