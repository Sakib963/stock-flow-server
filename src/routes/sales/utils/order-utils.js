// Shared helpers for the Sales & Orders module.
const { TABLE } = require("../../../utils/constant");
const { v4: uuidv4 } = require("uuid");
const { business_day, business_today } = require("../../../utils/business-time");

// Append an audit row to order_status_history. Takes the `tx` handle from
// `execute_transaction` so it lands inside the caller's transaction.
// `kind` is the axis that changed: Order, Delivery, Payment or Refund (sales REQ-118).
const recordStatusHistory = async (tx, { order_oid, kind = "Order", from_status, to_status, reason = null, user_id }) => {
    await tx.execute_value({
        text: `INSERT INTO ${TABLE.ORDER_STATUS_HISTORY}
                   (oid, order_oid, kind, from_status, to_status, reason, performed_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        values: [uuidv4(), order_oid, kind, from_status, to_status, reason, user_id],
    });
};

// How much of an order has actually been paid, resolved from the payment status
// rather than trusted from the client.
//
//   paid            -> the whole total. The app fills this in; a cashier who marks
//                      a sale paid should never also have to type the amount.
//   partially_paid  -> what was handed over, clamped into 0..total.
//   unpaid          -> nothing.
//
// Deriving it here rather than on the client is what keeps `amount_paid` and
// `payment_status` from contradicting each other. They used to: POS checkout wrote
// the status and never the amount, so every counter sale was recorded as paid with
// zero money against it.
const resolveAmountPaid = ({ payment_status, total_amount, amount_paid }) => {
    const total = Number(total_amount || 0);
    if (payment_status === "paid") return total;
    if (payment_status === "partially_paid") return Math.min(Math.max(Number(amount_paid || 0), 0), total);
    return 0;
};

// Invoice/order number: YYMMDD + 4-digit daily sequence, e.g. 2607200003.
// `read` is `tx.get_data`. Counting alone let two counters selling at once both count the same rows
// and mint the same number, so the count waits for any other sale minting one to commit first. The
// date is the business's day, the same day the count is taken on: the server's own date let a sale
// late in the evening reuse a number the next morning.
const nextInvoiceNo = async (read) => {
    await read({ text: "SELECT pg_advisory_xact_lock(hashtext('orders.invoice_no'))", values: [] });
    const [row] = await read({
        text: `SELECT to_char(${business_today}, 'YYMMDD') AS day, COUNT(*)::int AS today_count FROM ${TABLE.ORDERS} WHERE ${business_day("created_on")} = ${business_today}`,
        values: [],
    });
    return `${row.day}${String(row.today_count + 1).padStart(4, "0")}`;
};

module.exports = { recordStatusHistory, nextInvoiceNo, resolveAmountPaid };
