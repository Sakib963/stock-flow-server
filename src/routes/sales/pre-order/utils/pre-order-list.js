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

module.exports = { LIST, STATS, READY, OVERDUE };
