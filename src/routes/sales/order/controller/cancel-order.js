const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { releaseHolds } = require("../../utils/stock-movement");
const { recordStatusHistory } = require("../../utils/order-utils");
const { effectiveAmountPaid } = require("../../return/utils/return-utils");
const { refuse_change } = require("../utils/order-state");

// Cancel (sales REQ-53, REQ-123): only before dispatch, with a reason from the list. The held units
// go back to sellable; the shelf never changed, so no movement is written. Money the business holds
// (an advance, a prepaid order) becomes owed back: refund status To refund with the amount, settled
// later by recording the refund (REQ-114a). The delivery status stays, so a packed box is found.
const cancel_order = async (request, res) => {
    const { oid, reason_code, note } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const { invoice_no, refund_due } = await execute_transaction(async (tx) => {
            // Locked first, so the timeline records whether it was Pending or Confirmed when it was cancelled.
            const [before] = await tx.get_data({ text: `SELECT status FROM ${TABLE.ORDERS} WHERE oid = $1 FOR UPDATE`, values: [oid] });
            const cancelled = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS} SET status = 'Cancelled', cancelled_on = clock_timestamp(), cancel_reason_code = $1, cancel_reason = $2, edited_by = $3, edited_on = clock_timestamp()
                        WHERE oid = $4 AND channel = 'ONLINE' AND status IN ('Pending', 'Confirmed') AND dispatched_on IS NULL
                    RETURNING invoice_no, status, payment_status, total_amount, amount_paid, amount_refunded`,
                values: [reason_code, note, user_id, oid],
            });
            if (cancelled.rowCount !== 1) await refuse_change(tx, oid, "cancelled");
            const order = cancelled.rows[0];
            await releaseHolds(tx, { order_oid: oid, user_id });
            await recordStatusHistory(tx, { order_oid: oid, from_status: before.status, to_status: "Cancelled", reason: note ? `${reason_code}: ${note}` : reason_code, user_id });

            const refund_due = Math.max(0, effectiveAmountPaid(order) - Number(order.amount_refunded));
            if (refund_due > 0) {
                await tx.execute_value({ text: `UPDATE ${TABLE.ORDERS} SET refund_status = 'ToRefund', refund_due = $1, edited_by = $3, edited_on = clock_timestamp() WHERE oid = $2`, values: [refund_due, oid, user_id] });
                await recordStatusHistory(tx, { order_oid: oid, kind: "Refund", from_status: "None", to_status: "ToRefund", reason: String(refund_due), user_id });
            }
            await saveLogActivity({ reference_type: "order", reference_oid: oid, title: "Online order cancelled", description: `${order.invoice_no}, ${reason_code}${refund_due ? `, ${refund_due} to refund` : ""}` }, { tx, request });
            return { invoice_no: order.invoice_no, refund_due };
        });
        log.info(`Online order ${invoice_no} cancelled by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Order cancelled and its stock released", data: { oid, invoice_no, refund_due } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while cancelling an order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The order was not cancelled. Try again in a moment." });
    }
};

module.exports = cancel_order;
