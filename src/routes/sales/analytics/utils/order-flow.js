const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { json_row, json_rows } = require("./sql");
const { business_day_start } = require("../../../../utils/business-time");

// The online orders section reads the orders placed in the period and follows each one to where it
// is now, so every step and every rate divides by the same orders (sales analytics REQ-130 to 133,
// 148 to 151). A cancellation is on the business's side when the business could not serve it
// (REQ-133): those never count against a place, a product or a source.
const BUSINESS_REASONS = ["out_of_stock", "duplicate", "cannot_deliver"];

// An order is placed when it first went to Pending (the history row create-online-order writes), never
// by created_on: a draft saved on the 30th and placed on the 1st belongs to the 1st, and a discarded
// draft, which never went to Pending, was never placed.
//
// A line counts toward a value only when it is in the chosen category, as on the overview.
//
// $1 first day, $2 last day, $3 source, $4 category.
const IN_CATEGORY = `($4::text IS NULL OR EXISTS (SELECT 1 FROM ${TABLE.PRODUCT} p WHERE p.oid = oi.product_oid AND p.category_oid = $4))`;
// The orders first placed in the period, found from the history rows in it (a partial index on the
// placed rows, 2026-10-13-sales-analytics-indexes.sql) rather than by stamping every online order
// ever. An order placed earlier and edited in the period has an older first row, so it stays out.
// $1 first day, $2 last day.
const PLACED_IN_PERIOD = `
    placed_on AS (
        SELECT h.order_oid, MIN(h.performed_on) AS placed_on
          FROM ${TABLE.ORDER_STATUS_HISTORY} h
         WHERE h.kind = 'Order' AND h.to_status = 'Pending'
           AND h.order_oid IN (SELECT r.order_oid FROM ${TABLE.ORDER_STATUS_HISTORY} r
                                WHERE r.kind = 'Order' AND r.to_status = 'Pending'
                                  AND r.performed_on >= ${business_day_start("$1")} AND r.performed_on < ${business_day_start("$2::date + 1")})
         GROUP BY h.order_oid
        HAVING MIN(h.performed_on) >= ${business_day_start("$1")} AND MIN(h.performed_on) < ${business_day_start("$2::date + 1")}
    )`;

const PLACED = `
    ${PLACED_IN_PERIOD},
    stamped AS (
        SELECT o.*, placed_on.placed_on
          FROM placed_on JOIN ${TABLE.ORDERS} o ON o.oid = placed_on.order_oid
         WHERE o.channel = 'ONLINE' AND o.status <> 'Draft'
    ),
    placed AS (
        SELECT o.oid, o.status, o.placed_on, o.sold_on, o.dispatched_on, o.delivered_on, o.cancel_reason_code, o.payment_type, o.customer_oid,
               oo.confirmed_on, oo.confirmed_via, oo.district_oid, oo.source_oid, oo.risk_flag, oo.risk_own_delivered_rate,
               o.status = 'Cancelled' AS cancelled,
               COALESCE(o.status = 'Cancelled' AND o.cancel_reason_code = ANY('{${BUSINESS_REASONS.join(",")}}'::text[]), false) AS business_cancel,
               COALESCE(oo.delivery_status IN ('Failed', 'BackInShop'), false) AS failed,
               o.sold_on IS NOT NULL AND o.status <> 'Returned' AS kept,
               o.sold_on IS NOT NULL AND o.status = 'Returned' AS returned,
               (SELECT pr.not_delivered_reason FROM ${TABLE.PRODUCT_RETURN} pr WHERE pr.order_oid = o.oid AND pr.not_delivered_reason IS NOT NULL AND pr.status <> 'Cancelled' ORDER BY pr.created_on DESC LIMIT 1) AS failed_reason,
               (SELECT COALESCE(SUM((oi.unit_price - COALESCE(oi.discount, 0)) * oi.quantity), 0) FROM ${TABLE.ORDER_ITEMS} oi WHERE oi.order_oid = o.oid AND ${IN_CATEGORY}) AS value,
               (SELECT COALESCE(SUM((oi.unit_price - COALESCE(oi.discount, 0)) * (oi.quantity - oi.returned_qty)), 0) FROM ${TABLE.ORDER_ITEMS} oi WHERE oi.order_oid = o.oid AND ${IN_CATEGORY}) AS kept_value
          FROM stamped o
          JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
         WHERE ($3::text IS NULL OR oo.source_oid = $3)
           AND EXISTS (SELECT 1 FROM ${TABLE.ORDER_ITEMS} oi WHERE oi.order_oid = o.oid AND ${IN_CATEGORY})
    )`;

// Counts every rate needs, so each grouping below reads the same way.
const COUNTS = `
    COUNT(*)::int AS placed,
    COUNT(*) FILTER (WHERE cancelled AND NOT business_cancel)::int AS cancelled,
    COUNT(*) FILTER (WHERE business_cancel)::int AS business_cancelled,
    COUNT(*) FILTER (WHERE dispatched_on IS NOT NULL)::int AS dispatched,
    COUNT(*) FILTER (WHERE failed)::int AS failed`;

const FUNNEL_SQL = `
    SELECT COUNT(*)::int AS placed, COALESCE(SUM(value), 0)::float AS placed_value,
           COUNT(*) FILTER (WHERE confirmed_on IS NOT NULL)::int AS confirmed, COALESCE(SUM(value) FILTER (WHERE confirmed_on IS NOT NULL), 0)::float AS confirmed_value,
           COUNT(*) FILTER (WHERE dispatched_on IS NOT NULL)::int AS dispatched, COALESCE(SUM(value) FILTER (WHERE dispatched_on IS NOT NULL), 0)::float AS dispatched_value,
           COUNT(*) FILTER (WHERE sold_on IS NOT NULL)::int AS delivered, COALESCE(SUM(value) FILTER (WHERE sold_on IS NOT NULL), 0)::float AS delivered_value,
           COUNT(*) FILTER (WHERE kept)::int AS kept, COALESCE(SUM(kept_value) FILTER (WHERE kept), 0)::float AS kept_value,
           COUNT(*) FILTER (WHERE confirmed_on IS NULL AND NOT cancelled)::int AS waiting_confirm,
           COUNT(*) FILTER (WHERE confirmed_on IS NOT NULL AND dispatched_on IS NULL AND NOT cancelled)::int AS waiting_dispatch,
           COUNT(*) FILTER (WHERE dispatched_on IS NOT NULL AND sold_on IS NULL AND NOT failed)::int AS with_courier,
           COUNT(*) FILTER (WHERE returned)::int AS returned
      FROM placed`;

const CANCEL_REASONS_SQL = `
    SELECT cancel_reason_code AS reason, business_cancel AS business,
           COUNT(*) FILTER (WHERE confirmed_on IS NULL)::int AS before_confirm,
           COUNT(*) FILTER (WHERE confirmed_on IS NOT NULL)::int AS after_confirm
      FROM placed WHERE cancelled
     GROUP BY 1, 2 ORDER BY COUNT(*) DESC, 1`;

const FAILED_REASONS_SQL = `
    SELECT COALESCE(failed_reason, 'other') AS reason, COUNT(*)::int AS parcels
      FROM placed WHERE failed
     GROUP BY 1 ORDER BY 2 DESC, 1`;

const BY_PLACE_SQL = `
    SELECT d.oid, d.name_en, d.name_bn, ${COUNTS}
      FROM placed JOIN ${TABLE.DISTRICT} d ON d.oid = placed.district_oid
     GROUP BY d.oid, d.name_en, d.name_bn
     ORDER BY COUNT(*) DESC, d.name_en
     LIMIT 12`;

const BY_SOURCE_SQL = `
    SELECT s.oid, s.name, s.platform, ${COUNTS}
      FROM placed JOIN ${TABLE.ORDER_SOURCE} s ON s.oid = placed.source_oid
     GROUP BY s.oid, s.name, s.platform
     ORDER BY COUNT(*) DESC, s.name`;

// A product's cancellation rate counts units, so an order of three products counts against each (REQ-132).
const BY_PRODUCT_SQL = `
    SELECT p.oid, p.name,
           SUM(oi.quantity)::int AS units,
           COALESCE(SUM(oi.quantity) FILTER (WHERE placed.cancelled AND NOT placed.business_cancel), 0)::int AS cancelled_units,
           COALESCE(SUM(oi.quantity) FILTER (WHERE placed.business_cancel), 0)::int AS business_cancelled_units
      FROM placed
      JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = placed.oid
      JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid
     WHERE ($4::text IS NULL OR p.category_oid = $4)
     GROUP BY p.oid, p.name
     ORDER BY SUM(oi.quantity) DESC, p.name
     LIMIT 12`;

// Customers who called off at least two orders themselves: the ones a moderator should know about.
const BY_CUSTOMER_SQL = `
    SELECT c.oid, c.name, COUNT(*)::int AS placed, COUNT(*) FILTER (WHERE placed.cancelled AND NOT placed.business_cancel)::int AS cancelled
      FROM placed JOIN ${TABLE.CUSTOMERS} c ON c.oid = placed.customer_oid
     GROUP BY c.oid, c.name
    HAVING COUNT(*) FILTER (WHERE placed.cancelled AND NOT placed.business_cancel) >= 2
     ORDER BY 4 DESC, 3 DESC, c.name
     LIMIT 5`;

const BY_CONFIRM_SQL = `
    SELECT confirmed_via AS method, COUNT(*) FILTER (WHERE dispatched_on IS NOT NULL)::int AS dispatched, COUNT(*) FILTER (WHERE failed)::int AS failed
      FROM placed WHERE confirmed_via IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC, 1`;

const BY_TERMS_SQL = `
    SELECT payment_type AS terms, COUNT(*) FILTER (WHERE dispatched_on IS NOT NULL)::int AS dispatched, COUNT(*) FILTER (WHERE failed)::int AS failed
      FROM placed WHERE payment_type IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC, 1`;

// COD against an advance in the districts that sent the most parcels; a prepaid parcel had its money first, as an advance did.
const TERMS_BY_PLACE_SQL = `
    SELECT d.oid, d.name_en, d.name_bn,
           COUNT(*) FILTER (WHERE dispatched_on IS NOT NULL AND payment_type = 'COD')::int AS cod_dispatched,
           COUNT(*) FILTER (WHERE failed AND payment_type = 'COD')::int AS cod_failed,
           COUNT(*) FILTER (WHERE dispatched_on IS NOT NULL AND payment_type IN ('ADVANCE', 'PREPAID'))::int AS advance_dispatched,
           COUNT(*) FILTER (WHERE failed AND payment_type IN ('ADVANCE', 'PREPAID'))::int AS advance_failed
      FROM placed JOIN ${TABLE.DISTRICT} d ON d.oid = placed.district_oid
     GROUP BY d.oid, d.name_en, d.name_bn
    HAVING COUNT(*) FILTER (WHERE dispatched_on IS NOT NULL) > 0
     ORDER BY COUNT(*) FILTER (WHERE dispatched_on IS NOT NULL) DESC, d.name_en
     LIMIT 8`;

// What intake showed (REQ-150): the flag first, then the customer's own delivered rate.
const RISK_SQL = `
    WITH shown AS (
        SELECT *, CASE WHEN risk_flag = 'Blocked' THEN 'blocked'
                       WHEN risk_flag = 'Watch' THEN 'watch'
                       WHEN risk_own_delivered_rate IS NULL THEN 'no_history'
                       WHEN risk_own_delivered_rate < 80 THEN 'under_80'
                       ELSE 'from_80' END AS shown
          FROM placed
    )
    SELECT shown, COUNT(*)::int AS placed,
           COUNT(*) FILTER (WHERE kept)::int AS kept,
           COUNT(*) FILTER (WHERE failed)::int AS failed,
           COUNT(*) FILTER (WHERE returned)::int AS returned,
           COUNT(*) FILTER (WHERE cancelled AND NOT business_cancel)::int AS cancelled,
           COUNT(*) FILTER (WHERE NOT kept AND NOT failed AND NOT returned AND NOT cancelled)::int AS open
      FROM shown GROUP BY 1`;

// Median hours, so one parcel lost for a month does not set the figure.
const median = (from, to) => `ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (${to} - ${from})) / 3600) FILTER (WHERE ${to} IS NOT NULL AND ${from} IS NOT NULL AND ${to} >= ${from}))::numeric, 1)::float`;

const SPEED_SQL = `
    SELECT ${median("placed_on", "confirmed_on")} AS to_confirm,
           ${median("confirmed_on", "dispatched_on")} AS to_dispatch,
           ${median("dispatched_on", "delivered_on")} AS to_deliver
      FROM placed`;

const SPEED_BY_PLACE_SQL = `
    SELECT d.oid, d.name_en, d.name_bn, COUNT(*) FILTER (WHERE delivered_on IS NOT NULL)::int AS delivered, ${median("dispatched_on", "delivered_on")} AS to_deliver
      FROM placed JOIN ${TABLE.DISTRICT} d ON d.oid = placed.district_oid
     GROUP BY d.oid, d.name_en, d.name_bn
    HAVING COUNT(*) FILTER (WHERE delivered_on IS NOT NULL) > 0
     ORDER BY 5 DESC, d.name_en
     LIMIT 8`;

// One statement: placed is worked out once and every figure reads it, one round trip to the database.
const ORDER_FLOW_SQL = `
    WITH ${PLACED}
    SELECT ${json_row(FUNNEL_SQL)} AS funnel,
           ${json_rows(CANCEL_REASONS_SQL)} AS cancel_reasons,
           ${json_rows(FAILED_REASONS_SQL)} AS failed_reasons,
           ${json_rows(BY_PLACE_SQL)} AS places,
           ${json_rows(BY_SOURCE_SQL)} AS sources,
           ${json_rows(BY_PRODUCT_SQL)} AS products,
           ${json_rows(BY_CUSTOMER_SQL)} AS customers,
           ${json_rows(BY_CONFIRM_SQL)} AS confirming,
           ${json_rows(BY_TERMS_SQL)} AS terms,
           ${json_rows(TERMS_BY_PLACE_SQL)} AS terms_by_place,
           ${json_rows(RISK_SQL)} AS risk,
           ${json_row(SPEED_SQL)} AS speed,
           ${json_rows(SPEED_BY_PLACE_SQL)} AS speed_by_place`;

const read_order_flow = async (from, to, { source_oid, category_oid }) => (await get_data({ text: ORDER_FLOW_SQL, values: [from, to, source_oid, category_oid] }))[0];

module.exports = { read_order_flow, BUSINESS_REASONS, PLACED_IN_PERIOD };
