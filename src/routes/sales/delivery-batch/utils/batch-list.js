const { TABLE } = require("../../../../utils/constant");
const { TO_COLLECT } = require("./batch-orders");

const PARCELS = `LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS orders, COALESCE(SUM(${TO_COLLECT}) FILTER (WHERE o.status <> 'Cancelled'), 0)::bigint AS to_collect,
                       COUNT(*) FILTER (WHERE oo.delivery_status = 'Delivered')::int AS delivered,
                       COUNT(*) FILTER (WHERE oo.delivery_status IN ('Failed', 'BackInShop'))::int AS not_delivered
                  FROM ${TABLE.DELIVERY_BATCH_ORDER} bo
                  JOIN ${TABLE.ORDERS} o ON o.oid = bo.order_oid
                  JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
                 WHERE bo.batch_oid = b.oid AND bo.active) s ON true`;

// A handed over batch says how it ended once every parcel has an answer, worked out from its parcels
// rather than stored, so a parcel's answer undone puts the batch back with the courier.
const STATUS = `CASE WHEN b.status <> 'HandedOver' OR s.orders = 0 OR s.delivered + s.not_delivered < s.orders THEN b.status
                     WHEN s.not_delivered = 0 THEN 'Delivered'
                     WHEN s.delivered = 0 THEN 'NotDelivered'
                     ELSE 'PartlyDelivered' END`;

const LIST = {
    select: `b.oid, b.batch_no, b.courier, ${STATUS} AS status, b.created_on, b.handed_over_on, s.orders, s.to_collect, s.delivered`,
    from: `${TABLE.DELIVERY_BATCH} b ${PARCELS}`,
    search: ["b.batch_no"],
    filters: { status: STATUS, courier: "b.courier" },
    sortable: { created_on: "b.created_on", batch_no: "b.batch_no", handed_over_on: "b.handed_over_on" },
    default_sort: { key: "created_on", order: "desc" },
    tie_breaker: "b.oid",
};

const STATS = {
    open: `COUNT(*) FILTER (WHERE b.status = 'Open')::int`,
    handed_over: `COUNT(*) FILTER (WHERE ${STATUS} = 'HandedOver')::int`,
};

module.exports = { PARCELS, STATUS, LIST, STATS };
