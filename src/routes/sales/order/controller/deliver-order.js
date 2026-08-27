const crypto = require("crypto");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordStatusHistory } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");

// Mark a dispatched order DELIVERED. Only Confirmed + already-dispatched orders.
// Records COD collection when payment_collected is true (payment settled outside
// the app -- we only record status). No stock change (already deducted at dispatch).
const deliver_order = async (request, res) => {
    const user_id = request.credentials.user_id;
    const order_oid = request.body.oid;
    const collected = request.body.payment_collected === true;

    try {
        const invoice_no = await execute_transaction(async (tx) => {
            const result = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS}
                          SET status = 'Delivered', delivered_on = clock_timestamp(),
                              payment_status = CASE WHEN $1 THEN 'paid' ELSE payment_status END,
                              tracking_token = COALESCE(tracking_token, $4),
                              edited_by = $2, edited_on = clock_timestamp()
                        WHERE oid = $3 AND status = 'Confirmed' AND dispatched_on IS NOT NULL
                        RETURNING invoice_no`,
                values: [collected, user_id, order_oid, crypto.randomBytes(16).toString("hex")],
            });

            if (!result.rowCount) {
                const cur = await tx.get_data({ text: `SELECT status, dispatched_on FROM ${TABLE.ORDERS} WHERE oid = $1`, values: [order_oid] });
                if (!cur.length) fail(404, "Order not found");
                if (!cur[0].dispatched_on) fail(409, "Order must be sent for delivery before it can be marked delivered");
                fail(409, `Cannot mark delivered from status ${cur[0].status}`);
            }

            await recordStatusHistory(tx, { order_oid, from_status: "Confirmed", to_status: "Delivered", reason: collected ? "Delivered; COD collected" : "Delivered", user_id });
            return result.rows[0].invoice_no;
        });

        saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Order Delivered", description: `Order ${invoice_no} delivered${collected ? " (COD collected)" : ""}`, performed_by: user_id });
        log.info(`Order ${order_oid} delivered by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Order marked delivered" });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while delivering order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = deliver_order;
