const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

const stats_column_for_reason = (reason) => {
    const damaged = new Set(["damaged", "breakage"]);
    return damaged.has(reason) ? "total_damaged" : "total_wasted";
};

const reverse_product_dispose = async (request, res) => {
    const user_id = request.credentials.user_id;
    const dispose_oid = request.body.oid;

    try {
        const { dispose_no, line_count } = await execute_transaction(async (tx) => {
            // Transition Approved -> Reversed (guarded)
            const headerResult = await tx.execute_value({
                text: `UPDATE ${TABLE.PRODUCT_DISPOSE} SET status = $1, reversed_by = $2, reversed_on = clock_timestamp(), edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3 AND status = $4 RETURNING dispose_no`,
                values: ["Reversed", user_id, dispose_oid, "Approved"],
            });

            if (!headerResult.rowCount) {
                const statusCheck = await tx.get_data({
                    text: `SELECT status FROM ${TABLE.PRODUCT_DISPOSE} WHERE oid = $1`,
                    values: [dispose_oid],
                });
                if (!statusCheck.length) fail(404, "Product dispose not found");
                fail(409, "Only approved disposals can be reversed");
            }

            const lines = await tx.get_data({
                text: `SELECT product_oid, inventory_oid, dispose_quantity, reason FROM ${TABLE.DISPOSE_DETAILS} WHERE dispose_oid = $1`,
                values: [dispose_oid],
            });

            for (const line of lines) {
                // Restore the previously deducted stock
                await tx.execute_value({
                    text: `UPDATE ${TABLE.INVENTORY} SET quantity_available = quantity_available + $1, edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3`,
                    values: [line.dispose_quantity, user_id, line.inventory_oid],
                });

                // Roll back the product-level counter that approval incremented
                await tx.execute_value({
                    text: `UPDATE ${TABLE.PRODUCT_STATS} SET ${stats_column_for_reason(line.reason)} = GREATEST(${stats_column_for_reason(line.reason)} - $1, 0), last_edited_on = current_timestamp WHERE product_oid = $2`,
                    values: [line.dispose_quantity, line.product_oid],
                });
            }

            return { dispose_no: headerResult.rows[0].dispose_no, line_count: lines.length };
        });

        saveLogActivity({
            reference_type: "product-dispose",
            reference_oid: dispose_oid,
            title: "Dispose Reversed",
            description: `Disposal ${dispose_no} reversed; stock restored for ${line_count} batch(es)`,
            performed_by: user_id,
        });

        log.info(`Product dispose ${dispose_oid} reversed by: ${user_id}`);
        return res.status(200).json({ code: 200, message: "Product dispose reversed successfully!" });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while reversing product dispose: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = reverse_product_dispose;
