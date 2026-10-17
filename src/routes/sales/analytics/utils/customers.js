const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { IN_PERIOD, json_row, json_rows } = require("./sql");
const { business_day } = require("../../../../utils/business-time");

// Customers and places (sales analytics REQ-100, 103, 104, 158, 159). A sale is an order with sold_on
// that was not returned in full; a customer is counted once. Places are online orders by the district
// saved on the order (REQ-106); a counter sale has no address. Who came back is a fact about the
// customer, not a product, so repeat figures, cohorts and win back follow the channel alone.
//
// $1 first day, $2 last day, $3 channels, $4 source, $5 category.
const IN_CATEGORY = `($5::text IS NULL OR EXISTS (SELECT 1 FROM ${TABLE.ORDER_ITEMS} oi JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid WHERE oi.order_oid = o.oid AND p.category_oid = $5))`;

// Every sale of a known customer, ever, in the person's channels: what repeat and win back read.
const SALES = `
    sales AS (
        SELECT o.oid, o.customer_oid, o.sold_on, ${business_day("o.sold_on")} AS day
          FROM ${TABLE.ORDERS} o
         WHERE o.sold_on IS NOT NULL AND o.status <> 'Returned' AND o.customer_oid IS NOT NULL AND o.channel = ANY($3)
    ),
    ranked AS (
        SELECT customer_oid, day, ROW_NUMBER() OVER (PARTITION BY customer_oid ORDER BY sold_on, oid) AS n FROM sales
    )`;

// Online sales and parcels by the district on the order, with the filters the page carries.
const PLACES = `
    WITH sold AS (
        SELECT oo.district_oid, o.customer_oid,
               (SELECT COALESCE(SUM((oi.unit_price - COALESCE(oi.discount, 0)) * (oi.quantity - oi.returned_qty)), 0) FROM ${TABLE.ORDER_ITEMS} oi
                 WHERE oi.order_oid = o.oid AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM ${TABLE.PRODUCT} p WHERE p.oid = oi.product_oid AND p.category_oid = $5))) AS value
          FROM ${TABLE.ORDERS} o JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
         WHERE o.channel = 'ONLINE' AND 'ONLINE' = ANY($3) AND o.sold_on IS NOT NULL AND o.status <> 'Returned' AND ${IN_PERIOD("o.sold_on")}
           AND ($4::text IS NULL OR oo.source_oid = $4) AND ${IN_CATEGORY}
    ),
    sent AS (
        SELECT oo.district_oid, COUNT(*)::int AS dispatched, COUNT(*) FILTER (WHERE oo.delivery_status IN ('Failed', 'BackInShop'))::int AS failed
          FROM ${TABLE.ORDERS} o JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
         WHERE o.channel = 'ONLINE' AND 'ONLINE' = ANY($3) AND o.dispatched_on IS NOT NULL AND ${IN_PERIOD("o.dispatched_on")}
           AND ($4::text IS NULL OR oo.source_oid = $4) AND ${IN_CATEGORY}
         GROUP BY oo.district_oid
    ),
    bought AS (
        SELECT district_oid, COUNT(DISTINCT customer_oid)::int AS customers, COUNT(*)::int AS orders, SUM(value)::float AS sales FROM sold GROUP BY district_oid
    )
    SELECT d.oid, d.name_en, d.name_bn, d.division_oid,
           COALESCE(b.customers, 0)::int AS customers, COALESCE(b.orders, 0)::int AS orders, COALESCE(b.sales, 0)::float AS sales,
           COALESCE(s.dispatched, 0)::int AS dispatched, COALESCE(s.failed, 0)::int AS failed
      FROM ${TABLE.DISTRICT} d
      LEFT JOIN bought b ON b.district_oid = d.oid
      LEFT JOIN sent s ON s.district_oid = d.oid
     WHERE b.district_oid IS NOT NULL OR s.district_oid IS NOT NULL`;

// Customers who bought in the period: those whose first ever sale is in it are new.
const REPEAT = `
    WITH period AS (
        SELECT customer_oid, COUNT(*)::int AS sales FROM sales WHERE ${IN_PERIOD("sold_on")} GROUP BY customer_oid
    )
    SELECT COUNT(*)::int AS customers,
           COUNT(*) FILTER (WHERE first.day >= $1::date)::int AS new_customers,
           COUNT(*) FILTER (WHERE period.sales >= 2)::int AS bought_twice,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (s2.day - s1.day))
              FROM ranked s1 JOIN ranked s2 ON s2.customer_oid = s1.customer_oid AND s1.n = 1 AND s2.n = 2
             WHERE s2.day BETWEEN $1::date AND $2::date)::float AS days_to_second
      FROM period JOIN ranked first ON first.customer_oid = period.customer_oid AND first.n = 1`;

// Six months of first purchases up to the period's end, and how many came back in each month after.
const COHORTS = `
    WITH firsts AS (
        SELECT customer_oid, date_trunc('month', day)::date AS cohort FROM ranked WHERE n = 1
           AND day >= (date_trunc('month', $2::date) - interval '5 months')::date AND day <= $2::date
    ),
    returns AS (
        SELECT DISTINCT f.cohort, f.customer_oid, ((EXTRACT(YEAR FROM age(date_trunc('month', s.day), f.cohort)) * 12) + EXTRACT(MONTH FROM age(date_trunc('month', s.day), f.cohort)))::int AS month
          FROM firsts f JOIN ranked s ON s.customer_oid = f.customer_oid AND s.n > 1 AND s.day <= $2::date
    )
    SELECT to_char(f.cohort, 'YYYY-MM') AS cohort, COUNT(DISTINCT f.customer_oid)::int AS customers,
           COALESCE((SELECT json_agg(json_build_object('month', r.month, 'customers', r.customers) ORDER BY r.month)
                       FROM (SELECT month, COUNT(DISTINCT customer_oid)::int AS customers FROM returns WHERE returns.cohort = f.cohort AND month BETWEEN 1 AND 5 GROUP BY month) r), '[]'::json) AS returned
      FROM firsts f GROUP BY f.cohort ORDER BY f.cohort`;

// Bought twice or more, nothing in the 60 days up to the period's end: worth a message.
const WIN_BACK = `
    SELECT c.oid, c.name, COUNT(*)::int AS sales, to_char(MAX(s.day), 'YYYY-MM-DD') AS last_bought,
           ($2::date - MAX(s.day))::int AS days_since
      FROM sales s JOIN ${TABLE.CUSTOMERS} c ON c.oid = s.customer_oid
     WHERE s.day <= $2::date
     GROUP BY c.oid, c.name
    HAVING COUNT(*) >= 2 AND MAX(s.day) < $2::date - 60
     ORDER BY COUNT(*) DESC, MAX(s.day) DESC
     LIMIT 10`;

// Customers who bought in the period by the age band recorded on them, null where none was. Unlike
// repeat and win back, this follows the source and category, as buyers on the products tab do.
const AGES = `
    SELECT c.age_band, COUNT(*)::int AS customers
      FROM (SELECT DISTINCT o.customer_oid
              FROM ${TABLE.ORDERS} o LEFT JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
             WHERE o.sold_on IS NOT NULL AND o.status <> 'Returned' AND o.customer_oid IS NOT NULL AND o.channel = ANY($3) AND ${IN_PERIOD("o.sold_on")}
               AND ($4::text IS NULL OR oo.source_oid = $4) AND ${IN_CATEGORY}) p
      JOIN ${TABLE.CUSTOMERS} c ON c.oid = p.customer_oid
     GROUP BY c.age_band`;

const CUSTOMERS_SQL = `
    WITH ${SALES}
    SELECT ${json_rows(PLACES)} AS places,
           ${json_row(REPEAT)} AS repeat,
           ${json_rows(COHORTS)} AS cohorts,
           ${json_rows(WIN_BACK)} AS win_back,
           ${json_rows(AGES)} AS ages`;

const read_customers = async (from, to, { channels, source_oid, category_oid }) => (await get_data({ text: CUSTOMERS_SQL, values: [from, to, channels, source_oid, category_oid] }))[0];

module.exports = { read_customers };
