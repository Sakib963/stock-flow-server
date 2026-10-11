const { TABLE } = require("../../../../utils/constant");
const { TO_COLLECT } = require("./batch-orders");

const LIST = {
    select: `b.oid, b.batch_no, b.courier, b.status, b.created_on, b.handed_over_on, s.orders, s.to_collect, s.delivered`,
    from: `${TABLE.DELIVERY_BATCH} b
           LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS orders, COALESCE(SUM(${TO_COLLECT}) FILTER (WHERE o.status <> 'Cancelled'), 0)::bigint AS to_collect, COUNT(*) FILTER (WHERE oo.delivery_status = 'Delivered')::int AS delivered
                  FROM ${TABLE.DELIVERY_BATCH_ORDER} bo
                  JOIN ${TABLE.ORDERS} o ON o.oid = bo.order_oid
                  JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
                 WHERE bo.batch_oid = b.oid AND bo.active) s ON true`,
    search: ["b.batch_no"],
    filters: { status: "b.status", courier: "b.courier" },
    sortable: { created_on: "b.created_on", batch_no: "b.batch_no", handed_over_on: "b.handed_over_on" },
    default_sort: { key: "created_on", order: "desc" },
    tie_breaker: "b.oid",
};

const STATS = {
    open: `COUNT(*) FILTER (WHERE b.status = 'Open')::int`,
    handed_over: `COUNT(*) FILTER (WHERE b.status = 'HandedOver')::int`,
};

module.exports = { LIST, STATS };
