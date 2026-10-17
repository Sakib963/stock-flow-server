const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { IN_PERIOD } = require("./sql");

// Pre-orders and the counter on the overview (sales analytics REQ-160, REQ-161), in one statement.
// $1 first day, $2 last day, $3 channels, $4 source, $5 category.

// Bookings taken in the period and where each is now. The advance held is today's money, whenever the
// booking was taken: on every booking still open, and on a cancelled one until its refund is recorded.
const PRE_ORDERS = `
    SELECT COUNT(*) FILTER (WHERE ${IN_PERIOD("created_on")})::int AS booked,
           COALESCE(SUM(total_amount) FILTER (WHERE ${IN_PERIOD("created_on")}), 0)::float AS booked_value,
           COUNT(*) FILTER (WHERE ${IN_PERIOD("created_on")} AND status = 'Converted')::int AS converted,
           COUNT(*) FILTER (WHERE ${IN_PERIOD("created_on")} AND status = 'Cancelled')::int AS cancelled,
           COUNT(*) FILTER (WHERE ${IN_PERIOD("created_on")} AND status IN ('Pending', 'Confirmed'))::int AS open,
           COUNT(*) FILTER (WHERE status IN ('Pending', 'Confirmed'))::int AS open_now,
           (COALESCE(SUM(advance_paid - advance_refunded) FILTER (WHERE status IN ('Pending', 'Confirmed')), 0)
            + COALESCE(SUM(advance_refund_due - advance_refunded) FILTER (WHERE status = 'Cancelled' AND advance_refund_due > advance_refunded), 0))::float AS advance_held
      FROM ${TABLE.PRE_ORDERS}`;

// Counter sales kept in the period: how big a sale is, and how often the counter records who bought.
// With a category chosen only its lines count, as everywhere on the page; a source leaves the counter
// out, since a counter sale has none.
const LINE_IN_CATEGORY = `($5::text IS NULL OR EXISTS (SELECT 1 FROM ${TABLE.PRODUCT} p WHERE p.oid = oi.product_oid AND p.category_oid = $5))`;
const COUNTER = `
    WITH sold AS (
        SELECT o.oid, o.customer_oid,
               (SELECT COALESCE(SUM(oi.quantity - oi.returned_qty), 0) FROM ${TABLE.ORDER_ITEMS} oi WHERE oi.order_oid = o.oid AND ${LINE_IN_CATEGORY}) AS units,
               (SELECT COALESCE(SUM((oi.unit_price - COALESCE(oi.discount, 0)) * (oi.quantity - oi.returned_qty)), 0) FROM ${TABLE.ORDER_ITEMS} oi WHERE oi.order_oid = o.oid AND ${LINE_IN_CATEGORY}) AS value
          FROM ${TABLE.ORDERS} o
         WHERE o.channel = 'POS' AND 'POS' = ANY($3) AND $4::text IS NULL AND o.sold_on IS NOT NULL AND o.status <> 'Returned' AND ${IN_PERIOD("o.sold_on")}
           AND EXISTS (SELECT 1 FROM ${TABLE.ORDER_ITEMS} oi WHERE oi.order_oid = o.oid AND ${LINE_IN_CATEGORY})
    )
    SELECT COUNT(*)::int AS sales, COALESCE(SUM(units), 0)::int AS units, COALESCE(SUM(value), 0)::float AS value,
           COUNT(*) FILTER (WHERE customer_oid IS NULL)::int AS without_customer
      FROM sold`;

const EXTRAS_SQL = `SELECT (SELECT row_to_json(x) FROM (${PRE_ORDERS}) x) AS pre_orders, (SELECT row_to_json(x) FROM (${COUNTER}) x) AS counter`;

const read_extras = async (from, to, { channels, source_oid, category_oid }) => (await get_data({ text: EXTRAS_SQL, values: [from, to, channels, source_oid, category_oid] }))[0];

module.exports = { read_extras };
