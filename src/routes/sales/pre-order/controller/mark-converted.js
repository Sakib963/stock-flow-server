const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
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

    try {
        const { preorder_no, invoice_no } = await execute_transaction(async (tx) => {
            const currentRows = await tx.get_data({
                text: `SELECT preorder_no, status FROM ${TABLE.PRE_ORDERS} WHERE oid = $1 FOR UPDATE`,
                values: [pre_order_oid],
            });

            if (!currentRows.length) fail(404, "Pre-order not found");
            const current = currentRows[0];

            if (current.status !== "Pending" && current.status !== "Confirmed") {
                fail(409, `Only an open pre-order can be converted (this one is ${current.status})`);
            }

            const orderRows = await tx.get_data({ text: `SELECT invoice_no FROM ${TABLE.ORDERS} WHERE oid = $1`, values: [order_oid] });
            if (!orderRows.length) fail(404, "Order not found");

            await tx.execute_value({
                text: `UPDATE ${TABLE.PRE_ORDERS}
                          SET status = 'Converted', converted_on = clock_timestamp(), converted_order_oid = $1,
                              edited_by = $2, edited_on = clock_timestamp()
                        WHERE oid = $3`,
                values: [order_oid, user_id, pre_order_oid],
            });

            // Header link. The line-level link is written by the order create itself.
            await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS} SET pre_order_oid = $1 WHERE oid = $2`,
                values: [pre_order_oid, order_oid],
            });

            await recordPreOrderStatusHistory(tx, {
                pre_order_oid,
                from_status: current.status,
                to_status: "Converted",
                reason: `Converted to order ${orderRows[0].invoice_no}`,
                user_id,
            });

            return { preorder_no: current.preorder_no, invoice_no: orderRows[0].invoice_no };
        });

        saveLogActivity({
            reference_type: "pre_order",
            reference_oid: pre_order_oid,
            title: "Converted pre-order to order",
            performed_by: user_id,
            description: `Pre-order ${preorder_no} converted to order ${invoice_no}`,
        });

        log.info(`Pre-order ${pre_order_oid} converted to order ${order_oid} by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Pre-order converted to order" });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while marking pre-order converted: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = mark_converted;
