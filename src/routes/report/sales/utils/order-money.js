const { TABLE } = require("../../../../utils/constant");

// One row per order with its money, for the sales register and customer dues. The figures repeat
// customer-history.js so a customer's dues rows add up to the owed on their record page:
//   kept goods  (unit_price - discount) * (quantity - returned_qty), the discount being per unit
//   delivery    the charge, unless a confirmed return gave it back (only a full return can)
//   received    what the business keeps of what was paid: amount_paid (0 when unpaid) less refunds
//               sent and refunds still owed back; a paid order is never owed
//   owed        kept goods plus delivery less received, never below 0
// `where` narrows the orders and may use $-parameters of the caller's statement.
const ORDER_MONEY = (where) => `
    o AS (
        SELECT o.oid, o.customer_oid, o.invoice_no, o.channel, o.sold_on, o.customer_name, o.customer_phone, o.payment_method, o.payment_type, o.payment_status, o.status,
               o.delivery_charge, o.total_amount, o.amount_paid, o.amount_refunded, o.refund_due
          FROM ${TABLE.ORDERS} o
         WHERE ${where}
    ),
    lines AS (
        SELECT oi.order_oid,
               SUM(oi.unit_price * oi.quantity) AS goods,
               SUM(COALESCE(oi.discount, 0) * oi.quantity) AS discount,
               SUM((oi.unit_price - COALESCE(oi.discount, 0)) * oi.returned_qty) AS returns,
               SUM((oi.unit_price - COALESCE(oi.discount, 0)) * (oi.quantity - oi.returned_qty)) AS sales,
               SUM(oi.quantity - oi.returned_qty) AS kept_units,
               SUM(COALESCE(i.cost_price, 0) * (oi.quantity - oi.returned_qty)) AS cost,
               COALESCE(SUM(oi.quantity - oi.returned_qty) FILTER (WHERE i.cost_price IS NULL), 0) AS units_without_cost
          FROM ${TABLE.ORDER_ITEMS} oi
          JOIN o ON o.oid = oi.order_oid
          LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = oi.inventory_oid
         GROUP BY oi.order_oid
    ),
    money AS (
        SELECT o.*, COALESCE(l.goods, 0) AS goods, COALESCE(l.discount, 0) AS discount, COALESCE(l.returns, 0) AS returns, COALESCE(l.sales, 0) AS sales,
               COALESCE(l.kept_units, 0) AS kept_units, COALESCE(l.cost, 0) AS cost, COALESCE(l.units_without_cost, 0) AS units_without_cost,
               CASE WHEN EXISTS (SELECT 1 FROM ${TABLE.PRODUCT_RETURN} pr WHERE pr.order_oid = o.oid AND pr.status = 'Returned' AND pr.refund_delivery_charge) THEN 0 ELSE o.delivery_charge END AS delivery,
               CASE WHEN o.payment_status = 'paid' THEN o.total_amount WHEN o.payment_status = 'unpaid' THEN 0 ELSE o.amount_paid END - o.amount_refunded - o.refund_due AS received
          FROM o
          LEFT JOIN lines l ON l.order_oid = o.oid
    ),
    figures AS (
        SELECT money.*, sales + delivery AS customer_total,
               CASE WHEN payment_status = 'paid' THEN 0 ELSE GREATEST(0, sales + delivery - received) END AS owed
          FROM money
    )`;

module.exports = { ORDER_MONEY };
