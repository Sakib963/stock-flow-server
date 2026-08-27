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

module.exports = { recordStatusHistory, nextInvoiceNo };
