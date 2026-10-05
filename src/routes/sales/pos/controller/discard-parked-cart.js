const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { recordStatusHistory } = require("../../utils/order-utils");

// A discarded cart is Cancelled, never deleted, so its invoice number is accounted for. It held no
// stock, so nothing goes back.
const discard_parked_cart = async (request, res) => {
    const { oid } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const invoice_no = await execute_transaction(async (tx) => {
            const discarded = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS} SET status = 'Cancelled', cancelled_on = clock_timestamp(), edited_by = $1, edited_on = clock_timestamp()
                        WHERE oid = $2 AND channel = 'POS' AND status = 'Draft' AND created_by = $1
                    RETURNING invoice_no, draft_label`,
                values: [user_id, oid],
            });
            if (discarded.rowCount !== 1) fail(409, "This cart was already checked out or discarded at another counter.");
            const { invoice_no, draft_label } = discarded.rows[0];

            await recordStatusHistory(tx, { order_oid: oid, from_status: "Draft", to_status: "Cancelled", reason: "Parked cart discarded", user_id });
            await saveLogActivity({ reference_type: "order", reference_oid: oid, title: "Discarded parked cart", description: draft_label ? `${invoice_no} "${draft_label}"` : invoice_no }, { tx, request });
            return invoice_no;
        });

        log.info(`POS cart ${invoice_no} discarded by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Cart discarded", data: { oid } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while discarding a parked cart: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The cart was not discarded. Try again in a moment." });
    }
};

module.exports = discard_parked_cart;
