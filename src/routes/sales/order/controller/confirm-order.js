const crypto = require("crypto");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordStatusHistory } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");

// Confirm a PENDING online order -> CONFIRMED. Acceptance, not a second hold:
// stock is already held from creation, so this changes NO stock numbers. This is
// also where we mint the public tracking_token (COALESCE keeps an existing one).
const confirm_order = async (request, res) => {
    const user_id = request.credentials.user_id;
    const order_oid = request.body.oid;
    const tracking_token = crypto.randomBytes(16).toString("hex"); // 32-char, non-guessable

    try {
        const invoice_no = await execute_transaction(async (tx) => {
            const result = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS}
                          SET status = 'Confirmed', tracking_token = COALESCE(tracking_token, $3), edited_by = $1, edited_on = clock_timestamp()
                        WHERE oid = $2 AND status = 'Pending' RETURNING invoice_no`,
                values: [user_id, order_oid, tracking_token],
            });

            if (!result.rowCount) {
                const exists = await tx.get_data({ text: `SELECT status FROM ${TABLE.ORDERS} WHERE oid = $1`, values: [order_oid] });
                if (!exists.length) fail(404, "Order not found");
                fail(409, `Only Pending orders can be confirmed (this one is ${exists[0].status})`);
            }

            await recordStatusHistory(tx, { order_oid, from_status: "Pending", to_status: "Confirmed", reason: request.body.reason || "Order confirmed", user_id });
            return result.rows[0].invoice_no;
        });

        saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Order Confirmed", description: `Order ${invoice_no} confirmed`, performed_by: user_id });
        log.info(`Order ${order_oid} confirmed by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Order confirmed" });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while confirming order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = confirm_order;
