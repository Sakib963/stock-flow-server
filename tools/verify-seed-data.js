// Checks a seeded database the way the app reads it: the stock ledger in time order, the order and
// delivery lifecycle, money and refunds, pre-orders and product stats. Every check prints the rows
// that break it; a clean database prints nothing but PASS lines.
//
//   DB_HOST=localhost DB_PORT=5433 DB_USER=postgres DB_PASSWORD= DB_NAME=stockflow_seed DB_SSL=false node tools/verify-seed-data.js
const path = require("path");
require("dotenv").config({ path: process.env.ENV_FILE || path.resolve(__dirname, "../src/env/.env") });
const { Client } = require("pg");

// Each check returns the rows that break it.
const CHECKS = [
    ["Every batch's movements add up to what it holds", `SELECT i.oid, i.batch_code, i.quantity_available, m.s FROM inventory i LEFT JOIN (SELECT inventory_oid, SUM(quantity) s FROM stock_movement GROUP BY 1) m ON m.inventory_oid = i.oid WHERE COALESCE(m.s, 0) <> i.quantity_available`],
    ["Each movement's balance is the running total in time order", `SELECT inventory_oid, created_on, quantity, balance_after, running FROM (SELECT *, SUM(quantity) OVER (PARTITION BY inventory_oid ORDER BY created_on, oid) running FROM stock_movement) x WHERE running <> balance_after`],
    ["No batch ever went below zero", `SELECT inventory_oid, created_on, running FROM (SELECT *, SUM(quantity) OVER (PARTITION BY inventory_oid ORDER BY created_on, oid) running FROM stock_movement) x WHERE running < 0`],
    ["Nothing was sold from a batch before it arrived", `SELECT o.invoice_no FROM order_items oi JOIN orders o ON o.oid = oi.order_oid JOIN inventory i ON i.oid = oi.inventory_oid WHERE o.created_on < i.created_on`],
    ["Active holds never exceed what a batch holds", `SELECT i.batch_code, i.quantity_available, h.held FROM inventory i JOIN (SELECT inventory_oid, SUM(quantity) held FROM stock_hold WHERE status = 'Active' GROUP BY 1) h ON h.inventory_oid = i.oid WHERE h.held > i.quantity_available`],
    ["A sale is only a sale once stock left: sold_on matches the status", `SELECT invoice_no, channel, status, sold_on FROM orders WHERE (sold_on IS NOT NULL) <> (status IN ('Purchased', 'Delivered', 'PartiallyReturned') OR (status = 'Returned' AND sold_on IS NOT NULL))`],
    ["Line totals are (unit price - discount) x quantity", `SELECT order_oid FROM order_items WHERE total <> (unit_price - discount) * quantity`],
    ["Order totals match their lines and delivery charge", `SELECT o.invoice_no FROM orders o JOIN (SELECT order_oid, SUM(unit_price * quantity) sub, SUM(discount * quantity) dis FROM order_items GROUP BY 1) s ON s.order_oid = o.oid WHERE o.subtotal <> s.sub OR o.discount_total <> s.dis OR o.total_amount <> o.subtotal - o.discount_total + o.delivery_charge`],
    ["Paid means paid in full", `SELECT invoice_no FROM orders WHERE payment_status = 'paid' AND amount_paid <> total_amount`],
    ["Refunded money never passes what was paid", `SELECT invoice_no FROM orders WHERE amount_refunded > amount_paid OR refund_due < 0`],
    ["An online order's delivery state fits its status", `SELECT o.invoice_no, o.status, oo.delivery_status FROM orders o JOIN online_order oo ON oo.order_oid = o.oid WHERE o.status <> 'Draft' AND NOT (
            (o.status = 'Pending' AND oo.delivery_status = 'Preparing') OR (o.status = 'Confirmed' AND oo.delivery_status IN ('Preparing', 'Packed', 'WithCourier', 'Failed')) OR
            (o.status IN ('Delivered', 'PartiallyReturned') AND oo.delivery_status = 'Delivered') OR (o.status = 'Returned' AND oo.delivery_status IN ('Delivered', 'Failed', 'BackInShop')) OR (o.status = 'Cancelled'))`],
    ["Everything with the courier left in a handed-over delivery batch", `SELECT o.invoice_no FROM orders o JOIN online_order oo ON oo.order_oid = o.oid WHERE o.dispatched_on IS NOT NULL AND NOT EXISTS (SELECT 1 FROM delivery_batch_order bo JOIN delivery_batch b ON b.oid = bo.batch_oid WHERE bo.order_oid = o.oid AND b.status = 'HandedOver')`],
    ["Stock left the shelf exactly when the parcel did", `SELECT o.invoice_no, h.status FROM stock_hold h JOIN orders o ON o.oid = h.order_oid WHERE (o.dispatched_on IS NOT NULL AND h.status = 'Active') OR (o.dispatched_on IS NULL AND h.status = 'Deducted')`],
    ["A cancelled order holds nothing", `SELECT o.invoice_no FROM stock_hold h JOIN orders o ON o.oid = h.order_oid WHERE o.status = 'Cancelled' AND h.status = 'Active'`],
    ["Returned units never pass what was sold", `SELECT order_oid FROM order_items WHERE returned_qty > quantity OR returned_qty < 0`],
    ["Confirmed returns raised returned_qty by what they returned", `SELECT oi.oid, oi.returned_qty, r.units FROM order_items oi JOIN (SELECT rd.order_item_oid, SUM(rd.return_quantity) units FROM return_details rd JOIN product_return pr ON pr.oid = rd.return_oid WHERE pr.status = 'Returned' AND pr.return_reason <> 'not_delivered' GROUP BY 1) r ON r.order_item_oid = oi.oid WHERE oi.returned_qty <> r.units`],
    ["A fully returned delivered order is Returned, a partly returned one PartiallyReturned", `SELECT o.invoice_no, o.status FROM orders o JOIN (SELECT order_oid, SUM(quantity) q, SUM(returned_qty) r FROM order_items GROUP BY 1) s ON s.order_oid = o.oid WHERE o.sold_on IS NOT NULL AND ((s.r = 0 AND o.status NOT IN ('Purchased', 'Delivered')) OR (s.r > 0 AND s.r < s.q AND o.status <> 'PartiallyReturned') OR (s.r = s.q AND o.status <> 'Returned'))`],
    ["Every failed parcel has its return", `SELECT o.invoice_no FROM orders o JOIN online_order oo ON oo.order_oid = o.oid WHERE oo.delivery_status IN ('Failed', 'BackInShop') AND NOT EXISTS (SELECT 1 FROM product_return pr WHERE pr.order_oid = o.oid)`],
    ["Damaged returned units became an approved disposal, never a restock", `SELECT rd.oid FROM return_details rd JOIN product_return pr ON pr.oid = rd.return_oid WHERE pr.status = 'Returned' AND rd.condition = 'Damaged' AND (rd.dispose_oid IS NULL OR EXISTS (SELECT 1 FROM stock_movement m WHERE m.source_oid = pr.oid AND m.inventory_oid = rd.inventory_oid AND m.reason = 'returned' AND m.quantity > 0 AND NOT EXISTS (SELECT 1 FROM return_details g WHERE g.return_oid = pr.oid AND g.inventory_oid = rd.inventory_oid AND g.condition = 'Good')))`],
    ["A pending return has moved nothing", `SELECT pr.invoice_no FROM product_return pr WHERE pr.status = 'Pending' AND EXISTS (SELECT 1 FROM stock_movement m WHERE m.source_oid = pr.oid)`],
    ["A converted pre-order has its order", `SELECT preorder_no FROM pre_orders p WHERE status = 'Converted' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.oid = p.converted_order_oid AND o.pre_order_oid = p.oid)`],
    ["Product sold counts match the sold units", `SELECT ps.product_oid, ps.total_sold, s.units FROM product_stats ps JOIN (SELECT oi.product_oid, SUM(oi.quantity) units FROM order_items oi JOIN orders o ON o.oid = oi.order_oid WHERE o.sold_on IS NOT NULL GROUP BY 1) s ON s.product_oid = ps.product_oid JOIN product p ON p.oid = ps.product_oid WHERE ps.total_sold <> s.units`],
    ["Adjustments and disposals that were acted on have lines", `SELECT adjustment_number FROM stock_adjustment a WHERE status = 'Verified' AND NOT EXISTS (SELECT 1 FROM stock_adjustment_line l WHERE l.adjustment_oid = a.oid) UNION ALL SELECT dispose_no FROM product_dispose d WHERE status = 'Approved' AND NOT EXISTS (SELECT 1 FROM dispose_details x WHERE x.dispose_oid = d.oid)`],
    ["No seeded time lies in the future", `SELECT 'orders' t, max(created_on) FROM orders HAVING max(created_on) > (now() AT TIME ZONE 'UTC') UNION ALL SELECT 'movement', max(created_on) FROM stock_movement HAVING max(created_on) > (now() AT TIME ZONE 'UTC')`],
    ["Invoice numbers are the business day the order was placed", `SELECT invoice_no, created_on FROM orders WHERE left(invoice_no, 6) <> to_char((created_on AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka'), 'YYMMDD')`],
];

const verify = async () => {
    const client = new Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
    });
    await client.connect();
    await client.query("BEGIN READ ONLY");
    let failed = 0;
    try {
        for (const [name, sql] of CHECKS) {
            const { rows, rowCount } = await client.query(sql);
            if (!rowCount) {
                console.log(`PASS  ${name}`);
                continue;
            }
            failed += 1;
            console.log(`FAIL  ${name}: ${rowCount} row(s)`);
            console.table(rows.slice(0, 5));
        }
        const { rows } = await client.query(`
            SELECT 'POS sales' AS what, count(*)::int AS n FROM orders WHERE channel = 'POS'
            UNION ALL SELECT 'Online orders', count(*)::int FROM orders WHERE channel = 'ONLINE'
            UNION ALL SELECT 'Delivery batches', count(*)::int FROM delivery_batch
            UNION ALL SELECT 'Returns', count(*)::int FROM product_return
            UNION ALL SELECT 'Purchase orders', count(*)::int FROM purchase
            UNION ALL SELECT 'Batches', count(*)::int FROM inventory
            UNION ALL SELECT 'Customers', count(*)::int FROM customers
            UNION ALL SELECT 'Pre-orders', count(*)::int FROM pre_orders
            UNION ALL SELECT 'Adjustments', count(*)::int FROM stock_adjustment
            UNION ALL SELECT 'Disposals', count(*)::int FROM product_dispose
            UNION ALL SELECT 'Giveaways', count(*)::int FROM giveaway
            UNION ALL SELECT 'Campaigns', count(*)::int FROM campaign`);
        console.table(rows);
    } finally {
        await client.query("ROLLBACK");
        await client.end();
    }
    console.log(failed ? `${failed} check(s) failed.` : "Every check passed.");
    return failed === 0;
};

if (require.main === module) {
    verify()
        .then((passed) => process.exit(passed ? 0 : 1))
        .catch((e) => {
            console.error(`Verification could not run: ${e.message}`);
            process.exit(1);
        });
}

module.exports = { verify };
