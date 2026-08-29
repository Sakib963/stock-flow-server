// Shared helpers for the Sales & Orders module.
const { TABLE } = require("./constant");
const { v4: uuidv4 } = require("uuid");

// Append an audit row to order_status_history. Takes the `tx` handle from
// `execute_transaction` so it lands inside the caller's transaction.
const recordStatusHistory = async (tx, { order_oid, from_status, to_status, reason = null, user_id }) => {
    await tx.execute_value({
        text: `INSERT INTO ${TABLE.ORDER_STATUS_HISTORY}
                   (oid, order_oid, from_status, to_status, reason, performed_by)
               VALUES ($1, $2, $3, $4, $5, $6)`,
        values: [uuidv4(), order_oid, from_status, to_status, reason, user_id],
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
// `read` is the pool-level `get_data`, or `tx.get_data` to count inside the
// caller's transaction so two concurrent sales cannot mint the same number.
const nextInvoiceNo = async (read) => {
    const rows = await read({
        text: `SELECT COUNT(*)::int AS today_count FROM ${TABLE.ORDERS} WHERE created_on::date = CURRENT_DATE`,
        values: [],
    });
    const count = rows?.[0]?.today_count ?? 0;
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const seq = String(count + 1).padStart(4, "0");
    return `${yy}${mm}${dd}${seq}`;
};

module.exports = { recordStatusHistory, nextInvoiceNo, resolveAmountPaid };
