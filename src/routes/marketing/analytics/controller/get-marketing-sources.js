const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { channels_of } = require("../../../sales/utils/channels");
const { read_period } = require("../../../sales/analytics/utils/kept-sales");
const { BUSINESS_REASONS, PLACED_IN_PERIOD } = require("../../../sales/analytics/utils/order-flow");
const { sees_money } = require("../../../inventory/utils/sees-money");

// Each page or account online orders came in through (REQ-02): orders placed in the period, as
// sales analytics counts them, what they sold and kept, and how many fell through. $1, $2 the period,
// $3 the channels held, so a first-time customer is new to them, as in sales analytics.
const SOURCES_SQL = `
    WITH ${PLACED_IN_PERIOD},
    placed AS (
        SELECT o.oid, o.status, o.cancel_reason_code, o.sold_on, o.customer_oid, oo.source_oid, oo.delivery_status
          FROM placed_on JOIN ${TABLE.ORDERS} o ON o.oid = placed_on.order_oid JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
         WHERE o.channel = 'ONLINE' AND o.status <> 'Draft'
    ),
    kept AS (
        SELECT oi.order_oid,
               SUM((oi.unit_price - COALESCE(oi.discount, 0)) * (oi.quantity - oi.returned_qty)) AS sales,
               SUM((oi.unit_price - COALESCE(oi.discount, 0) - COALESCE(i.cost_price, 0)) * (oi.quantity - oi.returned_qty)) AS profit
          FROM ${TABLE.ORDER_ITEMS} oi LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = oi.inventory_oid
         WHERE oi.order_oid IN (SELECT oid FROM placed WHERE sold_on IS NOT NULL)
         GROUP BY oi.order_oid
    ),
    firsts AS (
        SELECT DISTINCT ON (o.customer_oid) o.customer_oid, o.oid
          FROM ${TABLE.ORDERS} o
         WHERE o.customer_oid IS NOT NULL AND o.sold_on IS NOT NULL AND o.status <> 'Returned' AND o.channel = ANY($3)
         ORDER BY o.customer_oid, o.sold_on, o.oid
    )
    SELECT s.oid, s.name, s.platform,
           COUNT(p.oid)::int AS placed,
           COUNT(p.oid) FILTER (WHERE p.sold_on IS NOT NULL AND p.status <> 'Returned')::int AS sold,
           -- A cancellation on the business's side is never held against the source, as in sales analytics.
           COUNT(p.oid) FILTER (WHERE p.status = 'Cancelled' AND NOT COALESCE(p.cancel_reason_code = ANY('{${BUSINESS_REASONS.join(",")}}'::text[]), false))::int AS cancelled,
           COUNT(p.oid) FILTER (WHERE p.delivery_status IN ('Failed', 'BackInShop'))::int AS refused,
           COALESCE(SUM(k.sales), 0)::float AS sales,
           COALESCE(SUM(k.profit), 0)::float AS profit,
           COUNT(f.oid)::int AS first_time
      FROM ${TABLE.ORDER_SOURCE} s
      LEFT JOIN placed p ON p.source_oid = s.oid
      LEFT JOIN kept k ON k.order_oid = p.oid
      LEFT JOIN firsts f ON f.oid = p.oid
     GROUP BY s.oid, s.name, s.platform
    HAVING COUNT(p.oid) > 0
     ORDER BY COALESCE(SUM(k.sales), 0) DESC, s.name`;

const get_marketing_sources = async (request, res) => {
    const { date_from, date_to } = request.query;
    try {
        // Sources are where online orders came in, so someone who sells only at the counter has none (REQ-14).
        const channels = await channels_of(request);
        if (!channels.includes("ONLINE")) return res.status(200).json({ code: 200, message: "Sources", data: { applies: false, sources: [] } });
        const [period, money_shown] = await Promise.all([read_period(date_from, date_to), sees_money(request)]);
        const rows = await get_data({ text: SOURCES_SQL, values: [period.date_from, period.date_to, channels] });
        // Profit is sales less buying price: without the permission, the price could be worked back from it.
        const sources = rows.map((row) => (money_shown ? row : { ...row, profit: null }));
        return res.status(200).json({ code: 200, message: "Sources", data: { applies: true, period, sources } });
    } catch (e) {
        log.error(`An exception occurred while comparing order sources: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not compare the order sources. Try again in a moment." });
    }
};

module.exports = get_marketing_sources;
