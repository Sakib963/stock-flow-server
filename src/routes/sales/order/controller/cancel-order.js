const { TABLE } = require("../../../../utils/constant");
const pool = require("../../../../utils/db.config");
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

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await client.query({
            text: `UPDATE ${TABLE.ORDERS}
                      SET status = 'Cancelled', cancelled_on = clock_timestamp(), cancel_reason = $1,
                          edited_by = $2, edited_on = clock_timestamp()
                    WHERE oid = $3 AND status IN ('Pending', 'Confirmed') AND dispatched_on IS NULL
                    RETURNING invoice_no`,
            values: [reason, user_id, order_oid],
        });

        if (!result.rowCount) {
            const cur = await client.query({ text: `SELECT status, dispatched_on FROM ${TABLE.ORDERS} WHERE oid = $1`, values: [order_oid] });
            await client.query("ROLLBACK");
            if (!cur.rowCount) return res.status(404).json({ code: 404, message: "Order not found" });
            const row = cur.rows[0];
            if (row.dispatched_on) return res.status(409).json({ code: 409, message: "Order already dispatched — use a return, not a cancellation" });
            return res.status(409).json({ code: 409, message: `This order cannot be cancelled (status ${row.status})` });
        }

        const released = await releaseHolds(client, { order_oid, user_id });
        await recordStatusHistory(client, { order_oid, from_status: null, to_status: "Cancelled", reason, user_id });
        await client.query("COMMIT");

        saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Order Cancelled", description: `Order ${result.rows[0].invoice_no} cancelled (${released} hold(s) released): ${reason}`, performed_by: user_id });
        log.info(`Order ${order_oid} cancelled by ${user_id}; ${released} holds released`);
        return res.status(200).json({ code: 200, message: "Order cancelled and stock released" });
    } catch (e) {
        try { await client.query("ROLLBACK"); } catch (r) { log.error(`Rollback failed on cancel: ${r?.message}`); }
        log.error(`An exception occurred while cancelling order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    } finally {
        client.release();
    }
};

module.exports = cancel_order;
