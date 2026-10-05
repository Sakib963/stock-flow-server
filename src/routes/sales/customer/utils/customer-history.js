const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");

// A customer's numbers and orders, only in the channels the person sells through (sales REQ-02).
//
// Lifetime value is what the customer kept (REQ-67, REQ-121): orders with sold_on, each line at
// (unit_price - discount) per unit times the units not returned (returned_qty, raised only when a
// return is confirmed), plus the delivery charge unless a confirmed return gave it back. Refunds of
// the lines are already the returned units, so they are not taken off a second time. An order
// returned in full kept nothing, not even its delivery charge, and is not counted as a sale, though
// its sold_on stays (REQ-122): the average purchase divides by sales, so it must not count it either.
//
// What the customer still owes comes from unpaid and part paid sales only: what they kept, less what
// they paid (read by payment_status, as effectiveAmountPaid does), plus what confirmed returns handed
// back out of that payment. A return worth more than was paid only lowers what is owed, never below 0.
//
// Parcels that came back count as refused until returns record the sub-reason (step 5 of the sales
// build), when this narrows to Refused.
const STATS_SQL = `
    WITH o AS (
        SELECT oid, channel, status, sold_on, created_on, delivery_charge, cancel_reason_code, payment_status, amount_paid
          FROM ${TABLE.ORDERS}
         WHERE customer_oid = $1 AND channel = ANY($2) AND status <> 'Draft'
    ),
    delivery_refunded AS (
        SELECT DISTINCT pr.order_oid
          FROM ${TABLE.PRODUCT_RETURN} pr
         WHERE pr.status IN ('Returned', 'Completed') AND pr.refund_delivery_charge AND pr.order_oid IN (SELECT oid FROM o)
    ),
    kept AS (
        SELECT SUM((oi.unit_price - COALESCE(oi.discount, 0)) * (oi.quantity - oi.returned_qty)) AS lines
          FROM ${TABLE.ORDER_ITEMS} oi
          JOIN o ON o.oid = oi.order_oid AND o.sold_on IS NOT NULL
    ),
    owed AS (
        SELECT SUM(GREATEST(0, COALESCE(k.kept, 0)
                   + CASE WHEN o.oid IN (SELECT order_oid FROM delivery_refunded) THEN 0 ELSE COALESCE(o.delivery_charge, 0) END
                   - CASE WHEN o.payment_status = 'partially_paid' THEN COALESCE(o.amount_paid, 0) ELSE 0 END
                   + COALESCE(r.refunded, 0))) AS amount
          FROM o
          LEFT JOIN (SELECT order_oid, SUM((unit_price - COALESCE(discount, 0)) * (quantity - returned_qty)) AS kept
                       FROM ${TABLE.ORDER_ITEMS} WHERE order_oid IN (SELECT oid FROM o) GROUP BY order_oid) k ON k.order_oid = o.oid
          LEFT JOIN (SELECT order_oid, SUM(refund_amount) AS refunded
                       FROM ${TABLE.PRODUCT_RETURN} WHERE status IN ('Returned', 'Completed') AND order_oid IN (SELECT oid FROM o) GROUP BY order_oid) r ON r.order_oid = o.oid
         WHERE o.sold_on IS NOT NULL AND o.status <> 'Cancelled' AND o.payment_status IN ('unpaid', 'partially_paid')
    )
    SELECT COUNT(*)::int AS orders,
           COUNT(*) FILTER (WHERE o.sold_on IS NOT NULL AND o.status <> 'Returned')::int AS sales,
           (COALESCE((SELECT lines FROM kept), 0)
             + COALESCE(SUM(o.delivery_charge) FILTER (WHERE o.sold_on IS NOT NULL AND o.status <> 'Returned' AND o.oid NOT IN (SELECT order_oid FROM delivery_refunded)), 0))::numeric AS lifetime_value,
           COUNT(*) FILTER (WHERE o.channel = 'ONLINE' AND o.sold_on IS NOT NULL)::int AS delivered,
           COUNT(*) FILTER (WHERE oo.delivery_status IN ('Failed', 'BackInShop'))::int AS refused_parcels,
           COUNT(*) FILTER (WHERE o.cancel_reason_code IN ('fake_order', 'unreachable'))::int AS cancelled_fake_or_unreachable,
           MAX(o.created_on) AS last_order_on,
           COALESCE((SELECT amount FROM owed), 0)::numeric AS owed
      FROM o
      LEFT JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid`;

const ORDERS_SQL = `
    SELECT o.oid, o.invoice_no, o.channel, o.status, o.payment_status, o.total_amount, o.created_on, o.sold_on, oo.delivery_status
      FROM ${TABLE.ORDERS} o
      LEFT JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
     WHERE o.customer_oid = $1 AND o.channel = ANY($2) AND o.status <> 'Draft'
     ORDER BY o.created_on DESC, o.oid
     LIMIT $3`;

const customer_stats = async (customer_oid, channels) => {
    const [row] = await get_data({ text: STATS_SQL, values: [customer_oid, channels] });
    const lifetime_value = Number(row.lifetime_value);
    const settled_parcels = row.delivered + row.refused_parcels;
    return {
        orders: row.orders,
        sales: row.sales,
        lifetime_value,
        average_order: row.sales ? Math.round(lifetime_value / row.sales) : null,
        delivered: row.delivered,
        refused_parcels: row.refused_parcels,
        delivered_rate: settled_parcels ? Math.round((row.delivered / settled_parcels) * 1000) / 10 : null,
        cancelled_fake_or_unreachable: row.cancelled_fake_or_unreachable,
        last_order_on: row.last_order_on,
        owed: Number(row.owed),
    };
};

const customer_orders = (customer_oid, channels, limit) => get_data({ text: ORDERS_SQL, values: [customer_oid, channels, limit] });

module.exports = { customer_stats, customer_orders };
