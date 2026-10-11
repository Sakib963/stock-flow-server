const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Records that the advance owed back on a cancelled booking was given. The app moves no money: this is
// what someone says was paid back.
const record_pre_order_refund = async (request, res) => {
    const { oid } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const outcome = await execute_transaction(async (tx) => {
            const refunded = await tx.execute_value({
                text: `UPDATE ${TABLE.PRE_ORDERS} SET advance_refunded = advance_refund_due, refunded_on = clock_timestamp(), edited_by = $1, edited_on = clock_timestamp()
                        WHERE oid = $2 AND status = 'Cancelled' AND advance_refunded < advance_refund_due RETURNING preorder_no, advance_refunded::int AS amount`,
                values: [user_id, oid],
            });
            if (refunded.rowCount !== 1) {
                const [row] = await tx.get_data({ text: `SELECT preorder_no FROM ${TABLE.PRE_ORDERS} WHERE oid = $1`, values: [oid] });
                if (!row) fail(404, "No pre-order with that number.");
                fail(409, `${row.preorder_no} has no refund owed. Reload it to see what changed.`);
            }
            const { preorder_no, amount } = refunded.rows[0];
            await saveLogActivity({ reference_type: "pre_order", reference_oid: oid, title: "Refund given", description: `${amount} of the advance on ${preorder_no} given back` }, { tx, request });
            return { preorder_no, amount };
        });
        log.info(`Refund on pre-order ${outcome.preorder_no} recorded by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Refund recorded", data: { oid, ...outcome } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while recording a pre-order's refund: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The refund was not recorded. Try again in a moment." });
    }
};

module.exports = record_pre_order_refund;
