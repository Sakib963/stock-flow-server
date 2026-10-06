const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { recordStatusHistory } = require("../../utils/order-utils");
const { refuse_change } = require("../utils/order-state");

// Record a refund (sales REQ-114, REQ-114a): the business says it sent money back for an order owed a
// refund. Nothing moves through the app. A part refund leaves the rest owed; the payment status says
// what the business still holds. Capped at what is owed, which a cancellation set from what was paid.
const record_order_refund = async (request, res) => {
    const { oid, amount, method, note } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const result = await execute_transaction(async (tx) => {
            const [order] = await tx.get_data({
                text: `SELECT invoice_no, refund_status, refund_due::int AS refund_due FROM ${TABLE.ORDERS} WHERE oid = $1 AND channel = 'ONLINE' AND status <> 'Draft' FOR UPDATE`,
                values: [oid],
            });
            if (!order || order.refund_status !== "ToRefund") await refuse_change(tx, oid, "refunded");
            if (amount > order.refund_due) fail(400, `Only ${order.refund_due} is owed back on ${order.invoice_no}. Enter that amount or less.`);

            const updated = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS}
                          SET amount_refunded = amount_refunded + $1, refund_due = refund_due - $1,
                              refund_status = CASE WHEN refund_due - $1 = 0 THEN 'Refunded' ELSE 'ToRefund' END,
                              payment_status = CASE WHEN amount_paid - amount_refunded - $1 <= 0 THEN 'refunded' ELSE 'partially_refunded' END,
                              edited_by = $3, edited_on = clock_timestamp()
                        WHERE oid = $2 AND refund_status = 'ToRefund' AND refund_due >= $1
                    RETURNING refund_status, refund_due::int AS refund_due`,
                values: [amount, oid, user_id],
            });
            if (updated.rowCount !== 1) await refuse_change(tx, oid, "refunded");
            const after = updated.rows[0];

            const detail = [`${amount} by ${method}`, note].filter(Boolean).join(": ");
            await recordStatusHistory(tx, { order_oid: oid, kind: "Refund", from_status: "ToRefund", to_status: after.refund_status, reason: detail, user_id });
            await saveLogActivity({ reference_type: "order", reference_oid: oid, title: "Refund recorded", description: `${order.invoice_no}, ${detail}${after.refund_due ? `, ${after.refund_due} still owed` : ""}` }, { tx, request });
            return { invoice_no: order.invoice_no, ...after };
        });
        log.info(`Refund recorded on ${result.invoice_no} by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Refund recorded", data: { oid, refund_status: result.refund_status, refund_due: result.refund_due } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while recording a refund: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not record the refund. Try again in a moment." });
    }
};

module.exports = record_order_refund;
