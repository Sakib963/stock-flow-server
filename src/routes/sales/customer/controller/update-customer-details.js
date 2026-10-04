const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { phone_taken, phone_conflict } = require("../utils/duplicate");

const FIELDS = ["name", "phone", "gender", "age_band", "first_source_oid", "social_handle", "note", "status"];

const update_customer_details = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    let changed = true;
    try {
        await execute_transaction(async (tx) => {
            const [current] = await tx.get_data({ text: `SELECT ${FIELDS.join(", ")} FROM ${TABLE.CUSTOMERS} WHERE oid = $1 FOR UPDATE`, values: [payload.oid] });
            if (!current) fail(404, "That customer no longer exists.");

            const changes = detectChanges(current, payload);
            if (!changes.length) {
                changed = false;
                return;
            }

            await tx.execute_value({
                text: `UPDATE ${TABLE.CUSTOMERS}
                          SET name = $2, phone = $3, phone_normalized = $3, gender = $4, age_band = $5, first_source_oid = $6, social_handle = $7, note = $8, status = $9,
                              edited_by = $10, edited_on = clock_timestamp()
                        WHERE oid = $1`,
                values: [payload.oid, payload.name, payload.phone, payload.gender, payload.age_band, payload.first_source_oid, payload.social_handle, payload.note, payload.status, user_id],
            });
            await saveLogActivity({ reference_type: "customer", reference_oid: payload.oid, title: "Updated customer", description: generateChangeDescription(`customer "${payload.name}"`, changes) }, { tx, request });
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        if (phone_taken(e)) {
            const conflict = await phone_conflict(payload.phone).catch(() => null);
            if (conflict) return res.status(409).json(conflict);
        }
        if (e?.code === "23503") return res.status(400).json({ code: 400, message: "That source no longer exists. Pick another source.", data: { field: "first_source_oid" } });
        log.error(`An exception occurred while updating customer ${payload.oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the customer. Try again in a moment." });
    }

    if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });
    return res.status(200).json({ code: 200, message: "Customer saved", data: { changed: true } });
};

module.exports = update_customer_details;
