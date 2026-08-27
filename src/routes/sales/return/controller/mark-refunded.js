const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Record that the refund on a confirmed return has actually been settled.
//
// The app never moves money: refund_amount is what the customer is owed, and this
// flips the return to Completed once someone has handed it back. Its only effect
// is to drop the return out of the "Refund outstanding" figure on the list page.
const mark_refunded = async (request, res) => {
    const user_id = request.credentials.user_id;
    const return_oid = request.body.oid;

    try {
        const outcome = await execute_transaction(async (tx) => {
            const result = await tx.execute_value({
                text: `UPDATE ${TABLE.PRODUCT_RETURN}
                          SET status = 'Completed', edited_by = $1, edited_on = clock_timestamp()
                        WHERE oid = $2 AND status = 'Returned'
                        RETURNING order_oid, invoice_no AS return_no, CAST(refund_amount AS INTEGER) AS refund_amount`,
                values: [user_id, return_oid],
            });

            if (!result.rowCount) {
                const exists = await tx.get_data({ text: `SELECT status FROM ${TABLE.PRODUCT_RETURN} WHERE oid = $1`, values: [return_oid] });
                if (!exists.length) fail(404, "Return not found");
                if (exists[0].status === "Completed") fail(409, "This refund is already marked as settled");
                if (exists[0].status === "Pending") fail(409, "Confirm the return before marking its refund settled");
                fail(409, `A ${exists[0].status} return has no refund to settle`);
            }

            return result.rows[0];
        });

        saveLogActivity({
            reference_type: "order",
            reference_oid: outcome.order_oid,
            title: "Refund Settled",
            description: `${outcome.return_no}: refund of ${outcome.refund_amount} marked as paid back to the customer`,
            performed_by: user_id,
        });

        log.info(`Return ${outcome.return_no} marked refunded by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Refund marked as settled" });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while marking a refund settled: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = mark_refunded;
