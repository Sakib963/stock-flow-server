const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { releaseHolds } = require("../../../../utils/stock-movement");
const { recordStatusHistory } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");

// Cancel an online order -- ONLY before Send for Delivery (Pending, or Confirmed
// with dispatched_on still null). Releases the hold (units become sellable again).
// Reason required. After dispatch the path is a return, not a cancellation.
// Prepaid refunds are settled outside the app (intent only) -- nothing recorded here.
const cancel_order = async (request, res) => {
    const user_id = request.credentials.user_id;
    const order_oid = request.body.oid;
    const reason = (request.body.reason || "").trim();
    if (!reason) return res.status(400).json({ code: 400, message: "A cancellation reason is required" });

    try {
        const { invoice_no, released } = await execute_transaction(async (tx) => {
            const result = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS}
                          SET status = 'Cancelled', cancelled_on = clock_timestamp(), cancel_reason = $1,
                              edited_by = $2, edited_on = clock_timestamp()
                        WHERE oid = $3 AND status IN ('Pending', 'Confirmed') AND dispatched_on IS NULL
                        RETURNING invoice_no`,
                values: [reason, user_id, order_oid],
            });

            if (!result.rowCount) {
                const cur = await tx.get_data({ text: `SELECT status, dispatched_on FROM ${TABLE.ORDERS} WHERE oid = $1`, values: [order_oid] });
                if (!cur.length) fail(404, "Order not found");
                if (cur[0].dispatched_on) fail(409, "Order already dispatched, use a return rather than a cancellation");
                fail(409, `This order cannot be cancelled (status ${cur[0].status})`);
            }

            const released = await releaseHolds(tx, { order_oid, user_id });
            await recordStatusHistory(tx, { order_oid, from_status: null, to_status: "Cancelled", reason, user_id });
            return { invoice_no: result.rows[0].invoice_no, released };
        });

        saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Order Cancelled", description: `Order ${invoice_no} cancelled (${released} hold(s) released): ${reason}`, performed_by: user_id });
        log.info(`Order ${order_oid} cancelled by ${user_id}; ${released} holds released`);
        return res.status(200).json({ code: 200, message: "Order cancelled and stock released" });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while cancelling order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = cancel_order;
