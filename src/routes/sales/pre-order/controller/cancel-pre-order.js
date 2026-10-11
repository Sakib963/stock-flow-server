const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { recordPreOrderStatusHistory, OPEN_STATUSES } = require("../utils/pre-order-utils");

const REASON_WORDS = { changed_mind: "the customer changed their mind", unreachable: "could not reach the customer", stock_not_coming: "the stock will not come", other: "other" };

// Cancelling releases nothing, since a booking never held stock. It records how much of the advance is
// owed back (REQ-06): all of it, part when a booking fee is kept, or none. That stays owed until
// Record refund says it was given back.
const cancel_pre_order = async (request, res) => {
    const { oid, reason, note, refund_due } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const outcome = await execute_transaction(async (tx) => {
            const [current] = await tx.get_data({ text: `SELECT preorder_no, status, advance_paid::int AS advance_paid FROM ${TABLE.PRE_ORDERS} WHERE oid = $1 FOR UPDATE`, values: [oid] });
            if (!current) fail(404, "No pre-order with that number.");
            if (!OPEN_STATUSES.includes(current.status)) fail(409, `${current.preorder_no} is already ${current.status === "Converted" ? "an order, so cancel the order instead" : "cancelled"}. Reload it to see what changed.`, { status: current.status });
            if (refund_due > current.advance_paid) fail(400, `The refund is more than the advance of ${current.advance_paid}. Lower it.`, { field: "refund_due" });

            await tx.execute_value({
                text: `UPDATE ${TABLE.PRE_ORDERS} SET status = 'Cancelled', cancelled_on = clock_timestamp(), cancel_reason = $1, advance_refund_due = $2, edited_by = $3, edited_on = clock_timestamp() WHERE oid = $4`,
                values: [reason, refund_due, user_id, oid],
            });
            await recordPreOrderStatusHistory(tx, { pre_order_oid: oid, from_status: current.status, to_status: "Cancelled", reason: note ?? reason, user_id });
            const owed = refund_due ? `, ${refund_due} of the advance to refund` : current.advance_paid ? ", the advance kept" : "";
            await saveLogActivity({ reference_type: "pre_order", reference_oid: oid, title: "Pre-order cancelled", description: `${current.preorder_no} cancelled, ${REASON_WORDS[reason]}${note ? `: ${note}` : ""}${owed}` }, { tx, request });
            return current;
        });
        log.info(`Pre-order ${outcome.preorder_no} cancelled by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Pre-order cancelled", data: { oid, preorder_no: outcome.preorder_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while cancelling a pre-order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The pre-order was not cancelled. Try again in a moment." });
    }
};

module.exports = cancel_pre_order;
