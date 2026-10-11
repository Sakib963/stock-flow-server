const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { business_number } = require("../../../../utils/business-time");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { find_or_create_customer } = require("../../customer/utils/find-or-create");
const { refusePastDate, recordPreOrderStatusHistory, writeLines } = require("../utils/pre-order-utils");

// A booking touches no stock (REQ-02, REQ-12). The oid is made by the client, so a request repeated
// after a lost answer finds the booking it already saved.
const create_pre_order = async (request, res) => {
    const { oid, customer, lines, advance_paid, advance_method, advance_reference, expected_date, notes } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const outcome = await execute_transaction(async (tx) => {
            await refusePastDate(tx, expected_date);
            const found = await find_or_create_customer(tx, customer, request);
            const saved = await tx.execute_value({
                text: `INSERT INTO ${TABLE.PRE_ORDERS} (oid, preorder_no, customer_oid, total_amount, advance_paid, advance_method, advance_reference, expected_date, notes, status, created_by)
                       VALUES ($1, ${business_number("PRE", "pre_order_number_seq")}, $2, 0, $3, $4, $5, $6, $7, 'Pending', $8)
                       ON CONFLICT (oid) DO NOTHING RETURNING preorder_no`,
                values: [oid, found.oid, advance_paid, advance_method, advance_reference, expected_date, notes, user_id],
            });
            if (saved.rowCount !== 1) {
                const [already] = await tx.get_data({ text: `SELECT preorder_no, created_by FROM ${TABLE.PRE_ORDERS} WHERE oid = $1`, values: [oid] });
                if (already?.created_by !== user_id) fail(409, "That pre-order number is already taken. Reload the page and try again.");
                return { preorder_no: already.preorder_no, repeated: true };
            }
            const total = await writeLines(tx, oid, lines);
            if (advance_paid > total) fail(400, "The advance is more than the pre-order's total. Lower the advance or check the prices.", { field: "advance_paid" });
            await tx.execute_value({ text: `UPDATE ${TABLE.PRE_ORDERS} SET subtotal = $1, total_amount = $1 WHERE oid = $2`, values: [total, oid] });
            const { preorder_no } = saved.rows[0];
            await recordPreOrderStatusHistory(tx, { pre_order_oid: oid, from_status: null, to_status: "Pending", user_id });
            await saveLogActivity({ reference_type: "pre_order", reference_oid: oid, title: "Pre-order saved", description: `${preorder_no} for ${found.name}, ${lines.length} line(s)` }, { tx, request });
            return { preorder_no, repeated: false };
        });
        if (!outcome.repeated) log.info(`Pre-order ${outcome.preorder_no} saved by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Pre-order saved", data: { oid, preorder_no: outcome.preorder_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while saving a pre-order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The pre-order was not saved. Try again in a moment." });
    }
};

module.exports = create_pre_order;
