const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { refuse_stale } = require("../../../../db/stale-edit");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { find_or_create_customer } = require("../../customer/utils/find-or-create");
const { refusePastDate, writeLines, OPEN_STATUSES } = require("../utils/pre-order-utils");

// Pending is fully editable; a Confirmed booking keeps its products and units, and only its prices,
// advance, customer, date and note change (REQ-05).
const update_pre_order = async (request, res) => {
    const { oid, version, customer, lines, advance_paid, advance_method, advance_reference, expected_date, notes } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const outcome = await execute_transaction(async (tx) => {
            await refuse_stale(tx, { table: TABLE.PRE_ORDERS, oid, version, gone: "No pre-order with that number." });
            const [current] = await tx.get_data({
                text: `SELECT preorder_no, status, customer_oid, total_amount::int AS total_amount, advance_paid::int AS advance_paid, advance_method, advance_reference, to_char(expected_date, 'YYYY-MM-DD') AS expected_date, notes
                         FROM ${TABLE.PRE_ORDERS} WHERE oid = $1 FOR UPDATE`,
                values: [oid],
            });
            if (!current) fail(404, "No pre-order with that number.");
            if (!OPEN_STATUSES.includes(current.status)) fail(409, `${current.preorder_no} is already ${current.status === "Converted" ? "an order" : "cancelled"}, so it can no longer be edited. Reload it to see what changed.`, { status: current.status });

            // A date already on the booking stays as it is: an overdue booking can still have its price or note changed.
            if (expected_date !== current.expected_date) await refusePastDate(tx, expected_date);

            const before = await tx.get_data({ text: `SELECT product_oid, quantity::int AS quantity, unit_price::int AS unit_price FROM ${TABLE.PRE_ORDER_ITEMS} WHERE pre_order_oid = $1 ORDER BY product_oid`, values: [oid] });
            const after = [...lines].sort((a, b) => a.product_oid.localeCompare(b.product_oid));
            const units_changed = before.length !== after.length || before.some((line, i) => line.product_oid !== after[i].product_oid || line.quantity !== after[i].quantity);
            if (units_changed && current.status === "Confirmed") fail(409, `${current.preorder_no} is confirmed, so its products and units stay as they are. Cancel it and take a new pre-order to change them.`, { field: "lines" });
            const prices_changed = before.some((line, i) => line.unit_price !== after[i]?.unit_price);

            const found = await find_or_create_customer(tx, customer, request);
            const total = units_changed || prices_changed ? await writeLines(tx, oid, lines) : current.total_amount;
            if (advance_paid > total) fail(400, "The advance is more than the pre-order's total. Lower the advance or check the prices.", { field: "advance_paid" });

            const changed = [
                units_changed && "products",
                prices_changed && !units_changed && "prices",
                found.oid !== current.customer_oid && "customer",
                (advance_paid !== current.advance_paid || advance_method !== current.advance_method || advance_reference !== current.advance_reference) && "advance",
                expected_date !== current.expected_date && "expected date",
                notes !== current.notes && "note",
            ].filter(Boolean);
            if (!changed.length) return { preorder_no: current.preorder_no, changed: false };

            await tx.execute_value({
                text: `UPDATE ${TABLE.PRE_ORDERS}
                          SET customer_oid = $1, subtotal = $2, total_amount = $2, advance_paid = $3, advance_method = $4, advance_reference = $5, expected_date = $6, notes = $7, edited_by = $8, edited_on = clock_timestamp()
                        WHERE oid = $9`,
                values: [found.oid, total, advance_paid, advance_method, advance_reference, expected_date, notes, user_id, oid],
            });
            await saveLogActivity({ reference_type: "pre_order", reference_oid: oid, title: "Pre-order edited", description: `${current.preorder_no}: ${changed.join(", ")} changed` }, { tx, request });
            return { preorder_no: current.preorder_no, changed: true };
        });
        if (outcome.changed) log.info(`Pre-order ${outcome.preorder_no} edited by ${user_id}`);
        return res.status(200).json({ code: 200, message: outcome.changed ? "Pre-order saved" : "Nothing changed", data: { oid, preorder_no: outcome.preorder_no, changed: outcome.changed } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while editing a pre-order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The pre-order was not saved. Try again in a moment." });
    }
};

module.exports = update_pre_order;
