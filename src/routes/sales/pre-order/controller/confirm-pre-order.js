const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { recordPreOrderStatusHistory } = require("../utils/pre-order-utils");

// Accepting a booking holds nothing: there is nothing to hold yet (REQ-02).
const confirm_pre_order = async (request, res) => {
    const { oid } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const preorder_no = await execute_transaction(async (tx) => {
            const confirmed = await tx.execute_value({
                text: `UPDATE ${TABLE.PRE_ORDERS} SET status = 'Confirmed', confirmed_on = clock_timestamp(), edited_by = $1, edited_on = clock_timestamp()
                        WHERE oid = $2 AND status = 'Pending' RETURNING preorder_no`,
                values: [user_id, oid],
            });
            if (confirmed.rowCount !== 1) {
                const [row] = await tx.get_data({ text: `SELECT preorder_no, status FROM ${TABLE.PRE_ORDERS} WHERE oid = $1`, values: [oid] });
                if (!row) fail(404, "No booking with that number.");
                fail(409, `${row.preorder_no} is already ${row.status.toLowerCase()}. Reload it to see what changed.`, { status: row.status });
            }
            const { preorder_no } = confirmed.rows[0];
            await recordPreOrderStatusHistory(tx, { pre_order_oid: oid, from_status: "Pending", to_status: "Confirmed", user_id });
            await saveLogActivity({ reference_type: "pre_order", reference_oid: oid, title: "Booking confirmed", description: `${preorder_no} confirmed` }, { tx, request });
            return preorder_no;
        });
        log.info(`Booking ${preorder_no} confirmed by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Booking confirmed", data: { oid, preorder_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while confirming a booking: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The booking was not confirmed. Try again in a moment." });
    }
};

module.exports = confirm_pre_order;
