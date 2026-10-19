const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day, business_day_start, business_today } = require("../../../../utils/business-time");

// Every sales figure reads these lines (sales analytics REQ-140, sales REQ-121): orders with sold_on,
// dated by it on the business's clock, each line at (unit_price - discount) per unit, kept units being
// those no confirmed return took back. A return lowers the month of the sale, so a closed month can
// still go down. Cost is the line's own batch, so a product bought at two prices costs what was sold.
//
// $1 first day, $2 last day (both business days, inclusive), $3 channels, $4 source, $5 category.
const lines_cte = (narrow = "") => `
    lines AS (
        SELECT o.oid AS order_oid, o.channel, o.sold_on, p.oid AS product_oid, p.name AS product_name, p.photo, oi.quantity, oi.returned_qty, oi.unit_price, COALESCE(oi.discount, 0) AS discount, i.cost_price
          FROM ${TABLE.ORDERS} o
          JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
          JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid
          LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = oi.inventory_oid
          LEFT JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
         WHERE o.sold_on >= ${business_day_start("$1")}
           AND o.sold_on < ${business_day_start("$2::date + 1")}
           AND o.channel = ANY($3)
           AND ($4::text IS NULL OR oo.source_oid = $4)
           AND ($5::text IS NULL OR p.category_oid = $5)
           ${narrow}
    )`;
const LINES = lines_cte();

const totals_sql = (narrow = "") => `
    WITH ${lines_cte(narrow)}
    SELECT COALESCE(SUM(unit_price * quantity), 0)::numeric AS list_price,
           COALESCE(SUM(discount * quantity), 0)::numeric AS discounts,
           COALESCE(SUM((unit_price - discount) * returned_qty), 0)::numeric AS returns,
           COALESCE(SUM((unit_price - discount) * (quantity - returned_qty)), 0)::numeric AS sales,
           COALESCE(SUM(COALESCE(cost_price, 0) * (quantity - returned_qty)), 0)::numeric AS cost,
           COALESCE(SUM(quantity - returned_qty) FILTER (WHERE cost_price IS NULL), 0)::int AS units_without_cost,
           COUNT(DISTINCT order_oid) FILTER (WHERE quantity > returned_qty)::int AS orders
      FROM lines`;

// The products that brought the most kept sales in the period, for a headline rather than a report.
const TOP_PRODUCTS_SQL = `
    WITH ${LINES}
    SELECT product_oid AS oid, product_name AS name, replace(MAX(photo), '/image/upload/', '/image/upload/c_fill,w_48,h_48,f_auto,q_auto/') AS photo_thumb,
           SUM(quantity - returned_qty)::int AS units,
           SUM((unit_price - discount) * (quantity - returned_qty))::float AS sales
      FROM lines
     GROUP BY product_oid, product_name
    HAVING SUM(quantity - returned_qty) > 0
     ORDER BY sales DESC, units DESC, product_name
     LIMIT 5`;

// The same totals for one person's own sales: $6 is the account that made the order.
const TOTALS_SQL = totals_sql();
const OWN_TOTALS_SQL = totals_sql("AND o.created_by = $6");

const DAILY_SQL = `
    WITH ${LINES}
    SELECT to_char(${business_day("sold_on")}, 'YYYY-MM-DD') AS day,
           SUM((unit_price - discount) * (quantity - returned_qty))::numeric AS sales,
           SUM((unit_price - discount - COALESCE(cost_price, 0)) * (quantity - returned_qty))::numeric AS profit
      FROM lines
     GROUP BY 1
     ORDER BY 1`;

// The same kept sales by channel, for a business that sells at the counter and online.
const BY_CHANNEL_SQL = `
    WITH ${LINES}
    SELECT channel,
           COALESCE(SUM((unit_price - discount) * (quantity - returned_qty)), 0)::float AS sales,
           COALESCE(SUM((unit_price - discount - COALESCE(cost_price, 0)) * (quantity - returned_qty)), 0)::float AS profit,
           COUNT(DISTINCT order_oid) FILTER (WHERE quantity > returned_qty)::int AS orders
      FROM lines GROUP BY channel ORDER BY channel`;

// A parcel counts in the period it was handed to the courier. Failed and Back in shop are the two
// ends of a parcel that never reached the customer (sales REQ-111).
const REFUSAL_SQL = `
    SELECT COUNT(*)::int AS dispatched,
           COUNT(*) FILTER (WHERE oo.delivery_status IN ('Failed', 'BackInShop'))::int AS failed
      FROM ${TABLE.ORDERS} o
      JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
     WHERE o.channel = 'ONLINE'
       AND o.dispatched_on >= ${business_day_start("$1")}
       AND o.dispatched_on < ${business_day_start("$2::date + 1")}
       AND ($3::text IS NULL OR oo.source_oid = $3)
       AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM ${TABLE.ORDER_ITEMS} oi JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid WHERE oi.order_oid = o.oid AND p.category_oid = $4))`;

// The chosen days, and the same number of days just before. With no start, the month of the end
// day (today when neither is given), so an end day alone never sits before its own start.
const PERIOD_SQL = `
    WITH chosen AS (
        SELECT COALESCE($1::date, date_trunc('month', COALESCE($2::date, ${business_today}))::date) AS date_from,
               COALESCE($2::date, ${business_today}) AS date_to
    )
    SELECT to_char(date_from, 'YYYY-MM-DD') AS date_from,
           to_char(date_to, 'YYYY-MM-DD') AS date_to,
           to_char(date_from - (date_to - date_from + 1), 'YYYY-MM-DD') AS previous_from,
           to_char(date_from - 1, 'YYYY-MM-DD') AS previous_to
      FROM chosen`;

// The sources the period can be narrowed to: the business's own list, retired ones included, since
// an old period still has their orders.
const SOURCES_SQL = `SELECT oid, name, platform FROM ${TABLE.ORDER_SOURCE} ORDER BY status = 'Active' DESC, name`;

const read_sources = async () => get_data({ text: SOURCES_SQL });

const read_period = async (date_from, date_to) => (await get_data({ text: PERIOD_SQL, values: [date_from ?? null, date_to ?? null] }))[0];

const numbers = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));

const read_totals = async (from, to, filters) => numbers((await get_data({ text: TOTALS_SQL, values: [from, to, filters.channels, filters.source_oid, filters.category_oid] }))[0]);

const read_own_totals = async (from, to, channels, user_id) => numbers((await get_data({ text: OWN_TOTALS_SQL, values: [from, to, channels, null, null, user_id] }))[0]);

const read_top_products = async (from, to, filters) => get_data({ text: TOP_PRODUCTS_SQL, values: [from, to, filters.channels, filters.source_oid, filters.category_oid] });

const read_daily = async (from, to, filters) =>
    (await get_data({ text: DAILY_SQL, values: [from, to, filters.channels, filters.source_oid, filters.category_oid] })).map((row) => ({ day: row.day, sales: Number(row.sales), profit: Number(row.profit) }));

const read_by_channel = async (from, to, filters) => get_data({ text: BY_CHANNEL_SQL, values: [from, to, filters.channels, filters.source_oid, filters.category_oid] });

const read_refusal = async (from, to, filters) => (await get_data({ text: REFUSAL_SQL, values: [from, to, filters.source_oid, filters.category_oid] }))[0];

module.exports = { read_period, read_totals, read_own_totals, read_top_products, read_daily, read_refusal, read_sources, read_by_channel };
