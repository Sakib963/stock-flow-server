const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { IN_PERIOD } = require("./sql");
const { business_local } = require("../../../../utils/business-time");
const { BUSINESS_REASONS, PLACED_IN_PERIOD } = require("./order-flow");

// When orders arrive, what was given away in discounts, and each person's figures (sales analytics
// REQ-105, REQ-152, REQ-153). A counter sale arrives when it is sold; an online order when it is
// placed, its first Pending row, as in the online section.
//
// $1 first day, $2 last day, $3 channels, $4 source, $5 category.
const HAS_CATEGORY = `($5::text IS NULL OR EXISTS (SELECT 1 FROM ${TABLE.ORDER_ITEMS} oi JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid WHERE oi.order_oid = o.oid AND p.category_oid = $5))`;

const ARRIVALS_SQL = `
    WITH arrivals AS (
        SELECT 'POS' AS channel, o.sold_on AS arrived
          FROM ${TABLE.ORDERS} o
         WHERE o.channel = 'POS' AND 'POS' = ANY($3) AND $4::text IS NULL AND o.sold_on IS NOT NULL AND ${IN_PERIOD("o.sold_on")} AND ${HAS_CATEGORY}
        UNION ALL
        SELECT 'ONLINE', placed_on.placed_on
          FROM placed_on
          JOIN ${TABLE.ORDERS} o ON o.oid = placed_on.order_oid
          JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
         WHERE o.channel = 'ONLINE' AND 'ONLINE' = ANY($3) AND o.status <> 'Draft' AND ($4::text IS NULL OR oo.source_oid = $4) AND ${HAS_CATEGORY}
    )
    SELECT channel, EXTRACT(DOW FROM ${business_local("arrived")})::int AS weekday, EXTRACT(HOUR FROM ${business_local("arrived")})::int AS hour, COUNT(*)::int AS orders
      FROM arrivals
     GROUP BY 1, 2, 3`;

// The lines of sales in the period, as the overview reads them, with who sold and the batch's limit.
const SOLD_LINES = `
    sold AS (
        SELECT o.oid AS order_oid, o.created_by, p.oid AS product_oid, p.name AS product_name,
               oi.quantity, oi.returned_qty, oi.unit_price, COALESCE(oi.discount, 0) AS discount, i.maximum_discount
          FROM ${TABLE.ORDERS} o
          JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
          JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid
          LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = oi.inventory_oid
          LEFT JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
         WHERE o.sold_on IS NOT NULL AND ${IN_PERIOD("o.sold_on")}
           AND o.channel = ANY($3)
           AND ($4::text IS NULL OR oo.source_oid = $4)
           AND ($5::text IS NULL OR p.category_oid = $5)
    )`;

// At the limit: a line whose per unit discount reached what the cart allowed it, the batch's maximum
// discount or the price itself when the maximum is set above it (sales/utils/cart.js).
const DISCOUNT_COLUMNS = `
    COALESCE(SUM(unit_price * quantity), 0)::float AS list_price,
    COALESCE(SUM(discount * quantity), 0)::float AS discount,
    COUNT(*)::int AS lines,
    COUNT(*) FILTER (WHERE discount > 0)::int AS discounted_lines,
    COUNT(*) FILTER (WHERE discount > 0 AND maximum_discount > 0 AND discount >= LEAST(maximum_discount, unit_price))::int AS at_limit`;

const DISCOUNT_TOTAL_SQL = `SELECT ${DISCOUNT_COLUMNS} FROM sold`;

const DISCOUNT_BY_PRODUCT_SQL = `
    SELECT product_oid AS oid, product_name AS name, ${DISCOUNT_COLUMNS}
      FROM sold GROUP BY product_oid, product_name
    HAVING SUM(discount * quantity) > 0
     ORDER BY SUM(discount * quantity) DESC, product_name
     LIMIT 8`;

// Each person: what they sold (kept, as everywhere), what they gave away, the online orders they took
// and how those ended, and the orders they confirmed.
const PEOPLE_SQL = `
    WITH selling AS (
        SELECT created_by AS person,
               COALESCE(SUM((unit_price - discount) * (quantity - returned_qty)), 0)::float AS sales,
               COUNT(DISTINCT order_oid) FILTER (WHERE quantity > returned_qty)::int AS sold_orders,
               ${DISCOUNT_COLUMNS}
          FROM sold GROUP BY created_by
    ),
    taking AS (
        SELECT placed.created_by AS person,
               COUNT(*)::int AS taken,
               COUNT(*) FILTER (WHERE placed.status = 'Cancelled' AND NOT COALESCE(placed.cancel_reason_code = ANY('{${BUSINESS_REASONS.join(",")}}'::text[]), false))::int AS cancelled,
               COUNT(*) FILTER (WHERE placed.status = 'Cancelled' AND COALESCE(placed.cancel_reason_code = ANY('{${BUSINESS_REASONS.join(",")}}'::text[]), false))::int AS business_cancelled,
               COUNT(*) FILTER (WHERE placed.dispatched_on IS NOT NULL)::int AS dispatched,
               COUNT(*) FILTER (WHERE placed.delivery_status IN ('Failed', 'BackInShop'))::int AS failed
          FROM (SELECT o.created_by, o.status, o.cancel_reason_code, o.dispatched_on, oo.delivery_status
                  FROM placed_on
                  JOIN ${TABLE.ORDERS} o ON o.oid = placed_on.order_oid
                  JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
                 WHERE o.channel = 'ONLINE' AND 'ONLINE' = ANY($3) AND o.status <> 'Draft' AND ($4::text IS NULL OR oo.source_oid = $4) AND ${HAS_CATEGORY}) placed
         GROUP BY placed.created_by
    ),
    confirming AS (
        SELECT oo.confirmed_by AS person, COUNT(*)::int AS confirmed
          FROM ${TABLE.ORDERS} o JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
         WHERE o.channel = 'ONLINE' AND 'ONLINE' = ANY($3) AND oo.confirmed_by IS NOT NULL AND ${IN_PERIOD("oo.confirmed_on")} AND ($4::text IS NULL OR oo.source_oid = $4) AND ${HAS_CATEGORY}
         GROUP BY oo.confirmed_by
    ),
    people AS (SELECT person FROM selling UNION SELECT person FROM taking UNION SELECT person FROM confirming)
    SELECT people.person AS email, l.name,
           COALESCE(s.sales, 0)::float AS sales, COALESCE(s.sold_orders, 0)::int AS sold_orders,
           COALESCE(s.list_price, 0)::float AS list_price, COALESCE(s.discount, 0)::float AS discount, COALESCE(s.at_limit, 0)::int AS at_limit,
           COALESCE(t.taken, 0)::int AS taken, COALESCE(t.cancelled, 0)::int AS cancelled, COALESCE(t.business_cancelled, 0)::int AS business_cancelled,
           COALESCE(t.dispatched, 0)::int AS dispatched, COALESCE(t.failed, 0)::int AS failed,
           COALESCE(c.confirmed, 0)::int AS confirmed
      FROM people
      LEFT JOIN selling s ON s.person = people.person
      LEFT JOIN taking t ON t.person = people.person
      LEFT JOIN confirming c ON c.person = people.person
      LEFT JOIN ${TABLE.LOGIN} l ON l.email = people.person
     ORDER BY COALESCE(s.sales, 0) DESC, COALESCE(t.taken, 0) DESC, people.person`;

// One statement: the sold lines and the placed orders are read once for all four figures.
const TEAM_SQL = `
    WITH ${SOLD_LINES}, ${PLACED_IN_PERIOD}
    SELECT (SELECT COALESCE(json_agg(x), '[]'::json) FROM (${ARRIVALS_SQL}) x) AS arrivals,
           (SELECT row_to_json(x) FROM (${DISCOUNT_TOTAL_SQL}) x) AS discount,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM (${DISCOUNT_BY_PRODUCT_SQL}) x) AS discount_by_product,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM (${PEOPLE_SQL}) x) AS people`;

const read_team = async (from, to, { channels, source_oid, category_oid }) => (await get_data({ text: TEAM_SQL, values: [from, to, channels, source_oid, category_oid] }))[0];

module.exports = { read_team };
