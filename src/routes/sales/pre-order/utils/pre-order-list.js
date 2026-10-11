const { TABLE } = require("../../../../utils/constant");
const { business_today } = require("../../../../utils/business-time");
const { SELLABLE_BY_PRODUCT_CTE } = require("./pre-order-utils");

const OPEN = `po.status IN ('Pending', 'Confirmed')`;
// Ready: every line could be converted now from sellable stock (definitions, Ready).
const READY = `(${OPEN} AND l.ready)`;
const OVERDUE = `(${OPEN} AND po.expected_date < ${business_today})`;

const LIST = {
    select: `po.oid, po.preorder_no, po.customer_oid, c.name AS customer_name, c.phone AS customer_phone, po.status, po.total_amount::int AS total_amount,
             po.advance_paid::int AS advance_paid, (po.advance_refund_due - po.advance_refunded)::int AS refund_owed, to_char(po.expected_date, 'YYYY-MM-DD') AS expected_date,
             po.created_on, l.units, ${READY} AS ready, ${OVERDUE} AS overdue`,
    from: `${TABLE.PRE_ORDERS} po
           JOIN ${TABLE.CUSTOMERS} c ON c.oid = po.customer_oid
           LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(poi.quantity), 0)::int AS units, COALESCE(bool_and(COALESCE(s.sellable, 0) >= poi.quantity), false) AS ready
                  FROM ${TABLE.PRE_ORDER_ITEMS} poi LEFT JOIN (${SELLABLE_BY_PRODUCT_CTE}) s ON s.product_oid = poi.product_oid
                 WHERE poi.pre_order_oid = po.oid) l ON true`,
    search: ["po.preorder_no", "c.name", "c.phone"],
    filters: { status: "po.status" },
    sortable: { created_on: "po.created_on", preorder_no: "po.preorder_no", expected_date: "po.expected_date" },
    default_sort: { key: "created_on", order: "desc" },
    tie_breaker: "po.oid",
};

const STATS = {
    open: `COUNT(*) FILTER (WHERE ${OPEN})::int`,
    ready: `COUNT(*) FILTER (WHERE ${READY})::int`,
    overdue: `COUNT(*) FILTER (WHERE ${OVERDUE})::int`,
    advance_held: `COALESCE(SUM(po.advance_paid) FILTER (WHERE ${OPEN}), 0)::int`,
};

// What the owner buys from (REQ-13): per product, the units on open bookings against what can be sold
// now. The advance is not split by product: it belongs to a booking, which may name several.
const BY_PRODUCT = {
    select: `b.product_oid AS oid, p.name AS product_name, p.sku, b.units, b.bookings, COALESCE(s.sellable, 0) AS sellable,
             GREATEST(b.units - COALESCE(s.sellable, 0), 0)::int AS to_get, b.oldest`,
    from: `(SELECT poi.product_oid, SUM(poi.quantity)::int AS units, COUNT(DISTINCT po.oid)::int AS bookings, MIN(po.created_on) AS oldest
              FROM ${TABLE.PRE_ORDER_ITEMS} poi JOIN ${TABLE.PRE_ORDERS} po ON po.oid = poi.pre_order_oid
             WHERE ${OPEN}
             GROUP BY poi.product_oid) b
           JOIN ${TABLE.PRODUCT} p ON p.oid = b.product_oid
           LEFT JOIN (${SELLABLE_BY_PRODUCT_CTE}) s ON s.product_oid = b.product_oid`,
    search: ["p.name", "p.sku"],
    filters: {},
    sortable: { units: "b.units", to_get: "GREATEST(b.units - COALESCE(s.sellable, 0), 0)", oldest: "b.oldest", product_name: "p.name" },
    default_sort: { key: "units", order: "desc" },
    tie_breaker: "b.product_oid",
};

const BY_PRODUCT_STATS = {
    products: `COUNT(*)::int`,
    units: `COALESCE(SUM(b.units), 0)::int`,
    to_get: `COALESCE(SUM(GREATEST(b.units - COALESCE(s.sellable, 0), 0)), 0)::int`,
};

module.exports = { LIST, STATS, READY, OVERDUE, BY_PRODUCT, BY_PRODUCT_STATS };
