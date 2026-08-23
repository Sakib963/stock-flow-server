const { TABLE } = require("../../../../utils/constant");
const pool = require("../../../../utils/db.config");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordPreOrderStatusHistory } = require("../../../../utils/pre-order-utils");
const { log } = require("../../../../utils/log");

// Close the loop after the order has been saved from the prefilled order page
// (FR-29). Sets both link directions and moves the booking to its terminal state.
//
// Conversion is idempotent (FR-30): a Converted pre-order cannot be converted
// again, so a repeated call is rejected rather than silently relinking.
const mark_converted = async (request, res) => {
    const user_id = request.credentials.user_id;
    const pre_order_oid = request.body.oid;
    const order_oid = request.body.order_oid;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const currentRes = await client.query({
            text: `SELECT preorder_no, status FROM ${TABLE.PRE_ORDERS} WHERE oid = $1 FOR UPDATE`,
            values: [pre_order_oid],
        });

        if (!currentRes.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ code: 404, message: "Pre-order not found" });
        }

        const current = currentRes.rows[0];

        if (current.status !== "Pending" && current.status !== "Confirmed") {
            await client.query("ROLLBACK");
            return res.status(409).json({ code: 409, message: `Only an open pre-order can be converted (this one is ${current.status})` });
        }

        const orderRes = await client.query({ text: `SELECT invoice_no FROM ${TABLE.ORDERS} WHERE oid = $1`, values: [order_oid] });
        if (!orderRes.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ code: 404, message: "Order not found" });
        }

        await client.query({
            text: `UPDATE ${TABLE.PRE_ORDERS}
                      SET status = 'Converted', converted_on = clock_timestamp(), converted_order_oid = $1,
                          edited_by = $2, edited_on = clock_timestamp()
                    WHERE oid = $3`,
            values: [order_oid, user_id, pre_order_oid],
        });

        // Header link. The line-level link is written by the order create itself.
        await client.query({
            text: `UPDATE ${TABLE.ORDERS} SET pre_order_oid = $1 WHERE oid = $2`,
            values: [pre_order_oid, order_oid],
        });

        await recordPreOrderStatusHistory(client, {
            pre_order_oid,
            from_status: current.status,
            to_status: "Converted",
            reason: `Converted to order ${orderRes.rows[0].invoice_no}`,
            user_id,
        });

        await client.query("COMMIT");

        saveLogActivity({
            reference_type: "pre_order",
            reference_oid: pre_order_oid,
            title: "Converted pre-order to order",
            performed_by: user_id,
            description: `Pre-order ${current.preorder_no} converted to order ${orderRes.rows[0].invoice_no}`,
        });

        log.info(`Pre-order ${pre_order_oid} converted to order ${order_oid} by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Pre-order converted to order" });
    } catch (e) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            log.error(`Rollback failed on mark converted: ${rollbackError?.message}`);
        }
        log.error(`An exception occurred while marking pre-order converted: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    } finally {
        client.release();
    }
};

module.exports = mark_converted;
