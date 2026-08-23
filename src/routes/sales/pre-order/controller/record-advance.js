const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Record / adjust the advance paid on an open pre-order (FR-17).
//
// The advance is a single editable field, not a ledger, so this activity log
// entry is the ONLY audit trail for the money. It therefore always records the
// old and new value, even when the amount is unchanged in other respects.
const record_advance = async (request, res) => {
    const user_id = request.credentials.user_id;
    const payload = request.body;
    const advance_paid = Number(payload.advance_paid || 0);

    try {
        const rows = await get_data({
            text: `SELECT preorder_no, status,
                          CAST(advance_paid AS INTEGER) AS advance_paid,
                          CAST(total_amount AS INTEGER) AS total_amount
                     FROM ${TABLE.PRE_ORDERS} WHERE oid = $1`,
            values: [payload.oid],
        });

        if (!rows.length) {
            return res.status(404).json({ code: 404, message: "Pre-order not found" });
        }

        const current = rows[0];

        if (current.status !== "Pending" && current.status !== "Confirmed") {
            return res.status(409).json({ code: 409, message: `Advance cannot be changed on a ${current.status} pre-order` });
        }

        if (advance_paid > Number(current.total_amount)) {
            return res.status(400).json({ code: 400, message: `Advance cannot exceed the pre-order total (${current.total_amount})` });
        }

        await execute_value({
            text: `UPDATE ${TABLE.PRE_ORDERS}
                      SET advance_paid = $1, advance_method = $2, advance_reference = $3,
                          edited_by = $4, edited_on = clock_timestamp()
                    WHERE oid = $5`,
            values: [advance_paid, payload.advance_method || null, payload.advance_reference || null, user_id, payload.oid],
        });

        saveLogActivity({
            reference_type: "pre_order",
            reference_oid: payload.oid,
            title: "Recorded advance payment",
            performed_by: user_id,
            description: `Advance on pre-order ${current.preorder_no} changed from ${current.advance_paid} to ${advance_paid}${payload.advance_method ? ` via ${payload.advance_method}` : ""}${payload.advance_reference ? ` (ref ${payload.advance_reference})` : ""}. Balance due ${Number(current.total_amount) - advance_paid}`,
        });

        log.info(`Advance on pre-order ${payload.oid} set to ${advance_paid} by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Advance recorded" });
    } catch (e) {
        log.error(`An exception occurred while recording pre-order advance: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = record_advance;
