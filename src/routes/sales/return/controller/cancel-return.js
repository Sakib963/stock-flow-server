const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Withdraw a Pending return. This is the step back for a return entered by
// mistake: a Pending return never moved stock, so cancelling it costs nothing and
// the order is left exactly as it was.
//
// A confirmed return cannot be cancelled. Once units are back on the shelf the
// correction is a new movement, not a rewrite of what happened.
const cancel_return = async (request, res) => {
    const user_id = request.credentials.user_id;
    const { oid: return_oid, reason } = request.body;

    try {
        const outcome = await execute_transaction(async (tx) => {
            // Guarded transition: the WHERE clause is the lock. If it matches no
            // row the return is either gone or no longer Pending.
            const result = await tx.execute_value({
                text: `UPDATE ${TABLE.PRODUCT_RETURN}
                          SET status = 'Cancelled',
                              notes = LEFT(COALESCE(notes || ' | ', '') || 'Cancelled: ' || $1, 256),
                              edited_by = $2, edited_on = clock_timestamp()
                        WHERE oid = $3 AND status = 'Pending'
                        RETURNING order_oid, invoice_no AS return_no`,
                values: [reason, user_id, return_oid],
            });

            if (!result.rowCount) {
                const exists = await tx.get_data({ text: `SELECT status FROM ${TABLE.PRODUCT_RETURN} WHERE oid = $1`, values: [return_oid] });
                if (!exists.length) fail(404, "Return not found");
                if (exists[0].status === "Cancelled") fail(409, "This return is already cancelled");
                fail(409, `Only a Pending return can be cancelled (this one is ${exists[0].status}, so its stock has already moved)`);
            }

            return result.rows[0];
        });

        saveLogActivity({
            reference_type: "order",
            reference_oid: outcome.order_oid,
            title: "Return Cancelled",
            description: `${outcome.return_no} cancelled before confirmation: ${reason}`,
            performed_by: user_id,
        });

        log.info(`Return ${outcome.return_no} cancelled by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Return cancelled" });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while cancelling a return: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = cancel_return;
