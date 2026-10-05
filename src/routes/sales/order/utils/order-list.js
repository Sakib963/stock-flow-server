const { TABLE } = require("../../../../utils/constant");

// Every order from both counters on one spine (sales REQ-02), without drafts: a parked cart and an
// unfinished online order live in their own drawers, not in the orders list.
const LIST = {
    select: `o.oid, o.invoice_no, o.channel, o.status, o.customer_oid, o.customer_name, o.customer_phone,
             o.total_amount::int AS total_amount, o.amount_paid::int AS amount_paid, o.payment_type, o.payment_status,
             o.refund_status, o.refund_due::int AS refund_due, o.created_on, o.sold_on, o.dispatched_on,
             o.created_by, u.name AS created_by_name, oo.delivery_status,
             d.name_en AS district_name_en, d.name_bn AS district_name_bn,
             (SELECT COALESCE(SUM(oi.quantity), 0)::int FROM ${TABLE.ORDER_ITEMS} oi WHERE oi.order_oid = o.oid) AS units`,
    from: `${TABLE.ORDERS} o
           LEFT JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
           LEFT JOIN ${TABLE.DISTRICT} d ON d.oid = oo.district_oid
           LEFT JOIN ${TABLE.LOGIN} u ON u.email = o.created_by`,
    search: ["o.invoice_no", "o.customer_name", "o.customer_phone"],
    filters: {
        channel: "o.channel",
        status: "o.status",
        delivery_status: "oo.delivery_status",
        payment_status: "o.payment_status",
        refund_status: "o.refund_status",
    },
    sortable: { created_on: "o.created_on", invoice_no: "o.invoice_no", total_amount: "o.total_amount" },
    default_sort: { key: "created_on", order: "desc" },
    tie_breaker: "o.oid",
};

// What needs a hand next, as the cards above the list.
const STATS = {
    pending: `COUNT(*) FILTER (WHERE o.status = 'Pending')::int`,
    to_dispatch: `COUNT(*) FILTER (WHERE o.status = 'Confirmed' AND o.dispatched_on IS NULL)::int`,
    with_courier: `COUNT(*) FILTER (WHERE oo.delivery_status = 'WithCourier')::int`,
    to_refund: `COUNT(*) FILTER (WHERE o.refund_status = 'ToRefund')::int`,
};

module.exports = { LIST, STATS };
