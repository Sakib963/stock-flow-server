const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { check_place, clear_default, describe_address } = require("../utils/address");

const FIELDS = ["label", "recipient_name", "recipient_phone", "address_line", "district_oid", "thana_oid", "area_oid", "area_text", "postal_code", "is_default"];

// Past orders keep their own copy of where they went (sales REQ-62), so this never reaches them.
const update_customer_address = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    try {
        const changed = await execute_transaction(async (tx) => {
            const [owner] = await tx.get_data({ text: `SELECT customer_oid FROM ${TABLE.CUSTOMER_ADDRESS} WHERE oid = $1`, values: [payload.oid] });
            if (!owner) fail(404, "That address no longer exists.");
            await tx.get_data({ text: `SELECT oid FROM ${TABLE.CUSTOMERS} WHERE oid = $1 FOR UPDATE`, values: [owner.customer_oid] });
            const [current] = await tx.get_data({
                text: `SELECT a.customer_oid, a.status, ${FIELDS.map((f) => `a.${f}`).join(", ")}
                         FROM ${TABLE.CUSTOMER_ADDRESS} a
                        WHERE a.oid = $1
                          FOR UPDATE`,
                values: [payload.oid],
            });
            if (!current) fail(404, "That address no longer exists.");
            if (current.status !== "Active") fail(409, "This address was removed. Add it again as a new address.", { status: current.status });

            // The default moves by making another address the default, never by leaving none.
            const next = { ...payload, is_default: current.is_default || payload.is_default };
            const changes = detectChanges(current, next);
            if (!changes.length) return false;

            await check_place(tx, next);
            if (next.is_default && !current.is_default) await clear_default(tx, current.customer_oid, user_id, payload.oid);

            const updated = await tx.execute_value({
                text: `UPDATE ${TABLE.CUSTOMER_ADDRESS}
                          SET label = $2, recipient_name = $3, recipient_phone = $4, address_line = $5, district_oid = $6, thana_oid = $7, area_oid = $8, area_text = $9, postal_code = $10, is_default = $11,
                              edited_by = $12, edited_on = clock_timestamp()
                        WHERE oid = $1 AND status = 'Active'`,
                values: [payload.oid, next.label, next.recipient_name, next.recipient_phone, next.address_line, next.district_oid, next.thana_oid, next.area_oid, next.area_text, next.postal_code, next.is_default, user_id],
            });
            if (updated.rowCount !== 1) fail(409, "This address changed while it was being saved. Reload and try again.");
            await saveLogActivity({ reference_type: "customer", reference_oid: current.customer_oid, title: "Updated address", description: generateChangeDescription(`address "${describe_address(next)}"`, changes) }, { tx, request });
            return true;
        });

        if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });
        return res.status(200).json({ code: 200, message: "Address saved", data: { changed: true } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while updating address ${payload.oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the address. Try again in a moment." });
    }
};

module.exports = update_customer_address;
