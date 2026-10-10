const { TABLE } = require("../../../../utils/constant");
const { business_month_start } = require("../../../../utils/business-time");

const LIST = {
    select: `pr.oid, pr.invoice_no AS return_no, pr.order_oid, o.invoice_no, o.channel, o.customer_oid, o.customer_name, o.customer_phone,
             pr.refund_amount::int AS refund_amount, pr.return_reason, pr.not_delivered_reason, pr.status, pr.created_on, pr.edited_on,
             u.name AS created_by_name, r.units, r.value`,
    from: `${TABLE.PRODUCT_RETURN} pr
           JOIN ${TABLE.ORDERS} o ON o.oid = pr.order_oid
           LEFT JOIN ${TABLE.LOGIN} u ON u.email = pr.created_by
           LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(rd.return_quantity), 0)::int AS units,
                       COALESCE(SUM(rd.return_quantity * GREATEST(oi.unit_price - COALESCE(oi.discount, 0), 0)), 0)::int AS value,
                       COALESCE(SUM(rd.return_quantity) FILTER (WHERE rd.condition = 'Damaged'), 0)::int AS damaged
                  FROM ${TABLE.RETURN_DETAILS} rd JOIN ${TABLE.ORDER_ITEMS} oi ON oi.oid = rd.order_item_oid
                 WHERE rd.return_oid = pr.oid) r ON true`,
    search: ["pr.invoice_no", "o.invoice_no", "o.customer_name", "o.customer_phone"],
    filters: { status: "pr.status", channel: "o.channel", reason: "pr.return_reason" },
    sortable: { created_on: "pr.created_on", return_no: "pr.invoice_no" },
    default_sort: { key: "created_on", order: "desc" },
    tie_breaker: "pr.oid",
};

// What needs a hand, then what came back this month, confirmed.
const STATS = {
    pending: `COUNT(*) FILTER (WHERE pr.status = 'Pending')::int`,
    parcels_to_receive: `COUNT(*) FILTER (WHERE pr.status = 'Pending' AND pr.return_reason = 'not_delivered')::int`,
    units_this_month: `COALESCE(SUM(r.units) FILTER (WHERE pr.status = 'Returned' AND pr.edited_on >= ${business_month_start}), 0)::int`,
    damaged_this_month: `COALESCE(SUM(r.damaged) FILTER (WHERE pr.status = 'Returned' AND pr.edited_on >= ${business_month_start}), 0)::int`,
};

module.exports = { LIST, STATS };
