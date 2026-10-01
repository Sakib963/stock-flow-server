const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { business_day } = require("../../../../utils/business-time");

// What an owner opens a supplier to find out: how much was bought and is still owed, whether orders
// arrive complete and on the promised day, how much of it had to be written off for the supplier's
// own fault, and how well it sells.
//
// Money is taken over Verified purchase orders only: a Submitted order is not goods received, and a
// Cancelled one was never bought. Paid follows payment_status, not paid_amount, the same rule the
// orders spine uses: rows marked paid carry a paid_amount short of their total.
//
// Spent and owed are on the order total the owner recorded, because whether a short delivery is
// billed in full is a deal between the owner and the supplier that the app cannot know. What
// actually arrived is reported beside it, so the gap is in front of the owner rather than decided for them.
//
// Damage counts only Approved disposals with reason quality_reject. "Damaged" and "return_unsellable"
// cannot tell a faulty product from one broken in the shop, and the owner's loss must not be charged
// to the supplier. What arrives short or broken is already the gap between ordered and received.
//
// Selling follows each sold unit to the batch it left from, and the batch to the purchase order it
// arrived on. Only realized sales count (Purchased, Delivered, PartiallyReturned), less the units
// returned, at (unit_price - discount) * quantity with discount per unit.
const SUPPLIER_STATS_SQL = `
      WITH received AS (
            SELECT p.oid, p.total_amount, p.created_on, p.verified_on, p.expected_delivery_date,
                   CASE p.payment_status WHEN 'paid' THEN p.total_amount WHEN 'partially_paid' THEN COALESCE(p.paid_amount, 0) ELSE 0 END AS paid
            FROM ${TABLE.PURCHASE} p
            WHERE p.supplier_oid = $1 AND p.status = 'Verified'
      ),
      lines AS (
            SELECT COALESCE(SUM(d.ordered_quantity), 0) AS ordered, COALESCE(SUM(d.verified_quantity), 0) AS received,
                   COALESCE(SUM(d.verified_quantity * COALESCE(d.verified_unit_price, d.ordered_unit_price)), 0) AS received_value
            FROM ${TABLE.PURCHASE_DETAILS} d JOIN received r ON r.oid = d.purchase_oid
      ),
      batches AS (
            SELECT i.oid, i.cost_price
            FROM ${TABLE.INVENTORY} i
            JOIN ${TABLE.PURCHASE_DETAILS} d ON d.oid = i.purchase_details_oid
            JOIN ${TABLE.PURCHASE} p ON p.oid = d.purchase_oid
            WHERE p.supplier_oid = $1
      ),
      faulty AS (
            SELECT COALESCE(SUM(dd.dispose_quantity), 0) AS units
            FROM ${TABLE.DISPOSE_DETAILS} dd
            JOIN ${TABLE.PRODUCT_DISPOSE} pd ON pd.oid = dd.dispose_oid
            JOIN batches b ON b.oid = dd.inventory_oid
            WHERE pd.status = 'Approved' AND dd.reason = 'quality_reject'
      ),
      sold AS (
            SELECT COALESCE(SUM(oi.quantity - COALESCE(oi.returned_qty, 0)), 0) AS units,
                   COALESCE(SUM((oi.unit_price - COALESCE(oi.discount, 0)) * (oi.quantity - COALESCE(oi.returned_qty, 0))), 0) AS sales,
                   COALESCE(SUM(b.cost_price * (oi.quantity - COALESCE(oi.returned_qty, 0))), 0) AS cost
            FROM ${TABLE.ORDER_ITEMS} oi
            JOIN ${TABLE.ORDERS} o ON o.oid = oi.order_oid
            JOIN batches b ON b.oid = oi.inventory_oid
            WHERE o.status IN ('Purchased', 'Delivered', 'PartiallyReturned')
      )
      SELECT
            (SELECT COUNT(*) FROM received)::int AS orders,
            (SELECT COUNT(*) FROM ${TABLE.PURCHASE} WHERE supplier_oid = $1 AND status = 'Submitted')::int AS open_orders,
            (SELECT COALESCE(SUM(total_amount), 0) FROM received) AS spent,
            (SELECT COALESCE(SUM(paid), 0) FROM received) AS paid,
            (SELECT MAX(created_on) FROM received) AS last_purchase_on,
            (SELECT ROUND(AVG(${business_day("verified_on")} - ${business_day("created_on")}), 1) FROM received WHERE verified_on IS NOT NULL) AS lead_days,
            (SELECT COUNT(*) FROM received WHERE expected_delivery_date IS NOT NULL AND verified_on IS NOT NULL)::int AS promised,
            (SELECT COUNT(*) FROM received WHERE expected_delivery_date IS NOT NULL AND ${business_day("verified_on")} <= expected_delivery_date)::int AS on_time,
            lines.ordered, lines.received, lines.received_value, faulty.units AS faulty, sold.units AS sold, sold.sales, sold.cost
      FROM lines, faulty, sold
`;

const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** The supplier record page's numbers. A rate with nothing to divide by is null, never 0%. */
const read_supplier_stats = async (oid) => {
      const [row] = await get_data({ text: SUPPLIER_STATS_SQL, values: [oid] });
      const spent = Number(row.spent);
      const paid = Number(row.paid);
      const ordered = Number(row.ordered);
      const received = Number(row.received);
      const sales = Number(row.sales);
      return {
            orders: row.orders,
            openOrders: row.open_orders,
            spent,
            paid,
            owed: Math.max(spent - paid, 0),
            receivedValue: Number(row.received_value),
            lastPurchaseOn: row.last_purchase_on,
            leadDays: row.lead_days === null ? null : Number(row.lead_days),
            promisedOrders: row.promised,
            onTimeRate: percent(row.on_time, row.promised),
            unitsOrdered: ordered,
            unitsReceived: received,
            shortRate: percent(ordered - received, ordered),
            faultyUnits: Number(row.faulty),
            faultyRate: percent(Number(row.faulty), received),
            unitsSold: Number(row.sold),
            sellThrough: percent(Number(row.sold), received),
            sales,
            profit: sales - Number(row.cost),
      };
};

module.exports = { read_supplier_stats };
