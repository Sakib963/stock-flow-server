const { TABLE } = require("../../../../utils/constant");
const pool = require("../../../../utils/db.config");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordPreOrderStatusHistory } = require("../../../../utils/pre-order-utils");
const { log } = require("../../../../utils/log");

// Confirm a Pending pre-order (FR-11). This is acceptance of the booking, not a
// stock action: nothing is held, because there is nothing to hold yet.
const confirm_pre_order = async (request, res) => {
    const user_id = request.credentials.user_id;
    const pre_order_oid = request.body.oid;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const result = await client.query({
            text: `UPDATE ${TABLE.PRE_ORDERS}
                      SET status = 'Confirmed', confirmed_on = clock_timestamp(),
                          edited_by = $1, edited_on = clock_timestamp()
                    WHERE oid = $2 AND status = 'Pending'
                    RETURNING preorder_no`,
            values: [user_id, pre_order_oid],
        });

        if (!result.rowCount) {
            const exists = await client.query({ text: `SELECT status FROM ${TABLE.PRE_ORDERS} WHERE oid = $1`, values: [pre_order_oid] });
            await client.query("ROLLBACK");
            if (!exists.rowCount) return res.status(404).json({ code: 404, message: "Pre-order not found" });
            return res.status(409).json({ code: 409, message: `Only a Pending pre-order can be confirmed (this one is ${exists.rows[0].status})` });
        }

        await recordPreOrderStatusHistory(client, {
            pre_order_oid,
            from_status: "Pending",
            to_status: "Confirmed",
            reason: request.body.reason || "Pre-order confirmed",
            user_id,
        });

        await client.query("COMMIT");

        saveLogActivity({
            reference_type: "pre_order",
            reference_oid: pre_order_oid,
            title: "Confirmed pre-order",
            performed_by: user_id,
            description: `Pre-order ${result.rows[0].preorder_no} confirmed`,
        });

        log.info(`Pre-order ${pre_order_oid} confirmed by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Pre-order confirmed" });
    } catch (e) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            log.error(`Rollback failed on confirm pre-order: ${rollbackError?.message}`);
        }
        log.error(`An exception occurred while confirming pre-order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    } finally {
        client.release();
    }
};

module.exports = confirm_pre_order;
