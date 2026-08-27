const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordPreOrderStatusHistory } = require("../../../../utils/pre-order-utils");
const { log } = require("../../../../utils/log");

// Confirm a Pending pre-order (FR-11). This is acceptance of the booking, not a
// stock action: nothing is held, because there is nothing to hold yet.
const confirm_pre_order = async (request, res) => {
    const user_id = request.credentials.user_id;
    const pre_order_oid = request.body.oid;

    try {
        const preorder_no = await execute_transaction(async (tx) => {
            const result = await tx.execute_value({
                text: `UPDATE ${TABLE.PRE_ORDERS}
                          SET status = 'Confirmed', confirmed_on = clock_timestamp(),
                              edited_by = $1, edited_on = clock_timestamp()
                        WHERE oid = $2 AND status = 'Pending'
                        RETURNING preorder_no`,
                values: [user_id, pre_order_oid],
            });

            if (!result.rowCount) {
                const exists = await tx.get_data({ text: `SELECT status FROM ${TABLE.PRE_ORDERS} WHERE oid = $1`, values: [pre_order_oid] });
                if (!exists.length) fail(404, "Pre-order not found");
                fail(409, `Only a Pending pre-order can be confirmed (this one is ${exists[0].status})`);
            }

            await recordPreOrderStatusHistory(tx, {
                pre_order_oid,
                from_status: "Pending",
                to_status: "Confirmed",
                reason: request.body.reason || "Pre-order confirmed",
                user_id,
            });

            return result.rows[0].preorder_no;
        });

        saveLogActivity({
            reference_type: "pre_order",
            reference_oid: pre_order_oid,
            title: "Confirmed pre-order",
            performed_by: user_id,
            description: `Pre-order ${preorder_no} confirmed`,
        });

        log.info(`Pre-order ${pre_order_oid} confirmed by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Pre-order confirmed" });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while confirming pre-order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = confirm_pre_order;
