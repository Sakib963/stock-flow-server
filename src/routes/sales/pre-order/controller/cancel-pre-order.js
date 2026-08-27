const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordPreOrderStatusHistory } = require("../../../../utils/pre-order-utils");
const { log } = require("../../../../utils/log");

// Cancel a Pending or Confirmed pre-order (FR-12). Reason required.
//
// "Refunded" is NOT a status (FR-14): the refund is money movement recorded on
// the cancelled booking. A cancelled pre-order can be fully refunded, partly
// refunded (a non-refundable booking fee retained), or not refunded at all, and
// the status never has to lie about which.
//
// No stock is released because a pre-order never held any.
const cancel_pre_order = async (request, res) => {
    const user_id = request.credentials.user_id;
    const pre_order_oid = request.body.oid;
    const reason = (request.body.reason || "").trim();
    const refundRequested = request.body.advance_refunded !== null && request.body.advance_refunded !== undefined;
    const advance_refunded = Number(request.body.advance_refunded || 0);

    if (!reason) {
        return res.status(400).json({ code: 400, message: "A cancellation reason is required" });
    }

    try {
        const current = await execute_transaction(async (tx) => {
            const currentRows = await tx.get_data({
                text: `SELECT preorder_no, status, CAST(advance_paid AS INTEGER) AS advance_paid
                         FROM ${TABLE.PRE_ORDERS} WHERE oid = $1 FOR UPDATE`,
                values: [pre_order_oid],
            });

            if (!currentRows.length) fail(404, "Pre-order not found");
            const current = currentRows[0];

            if (current.status !== "Pending" && current.status !== "Confirmed") {
                fail(409, `This pre-order cannot be cancelled (status ${current.status})`);
            }
            if (advance_refunded > Number(current.advance_paid)) {
                fail(400, `Refund cannot exceed the advance paid (${current.advance_paid})`);
            }

            await tx.execute_value({
                // $2 is cast explicitly: without it Postgres tries to deduce one type
                // from both the numeric assignment and the CASE comparison, and fails
                // with "inconsistent types deduced for parameter $2".
                text: `UPDATE ${TABLE.PRE_ORDERS}
                          SET status = 'Cancelled', cancelled_on = clock_timestamp(), cancel_reason = $1,
                              advance_refunded = $2::numeric,
                              refunded_on = CASE WHEN $2::numeric > 0 THEN clock_timestamp() ELSE NULL END,
                              edited_by = $3, edited_on = clock_timestamp()
                        WHERE oid = $4`,
                values: [reason, advance_refunded, user_id, pre_order_oid],
            });

            await recordPreOrderStatusHistory(tx, {
                pre_order_oid,
                from_status: current.status,
                to_status: "Cancelled",
                reason,
                user_id,
            });

            return current;
        });

        const retained = Number(current.advance_paid) - advance_refunded;
        const moneyNote = !refundRequested || advance_refunded === 0 ? `no refund recorded (advance held ${current.advance_paid})` : `refunded ${advance_refunded} of ${current.advance_paid}${retained > 0 ? `, ${retained} retained` : ""}`;

        saveLogActivity({
            reference_type: "pre_order",
            reference_oid: pre_order_oid,
            title: "Cancelled pre-order",
            performed_by: user_id,
            description: `Pre-order ${current.preorder_no} cancelled: ${reason}. Refund: ${moneyNote}`,
        });

        log.info(`Pre-order ${pre_order_oid} cancelled by ${user_id}; ${moneyNote}`);
        return res.status(200).json({ code: 200, message: "Pre-order cancelled" });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while cancelling pre-order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = cancel_pre_order;
