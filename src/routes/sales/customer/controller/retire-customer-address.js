const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { describe_address } = require("../utils/address");

// Retired, never deleted: orders that went there point at it. When the default is retired the
// newest remaining address takes its place, so the next order still starts from one.
const retire_customer_address = async (request, res) => {
    const { oid } = request.body;
    const user_id = request.credentials.user_id;
    try {
        await execute_transaction(async (tx) => {
            const [owner] = await tx.get_data({ text: `SELECT customer_oid FROM ${TABLE.CUSTOMER_ADDRESS} WHERE oid = $1`, values: [oid] });
            if (!owner) fail(404, "That address no longer exists.");
            await tx.get_data({ text: `SELECT oid FROM ${TABLE.CUSTOMERS} WHERE oid = $1 FOR UPDATE`, values: [owner.customer_oid] });
            const [current] = await tx.get_data({
                text: `SELECT a.customer_oid, a.status, a.is_default, a.label, a.recipient_name, a.address_line
                         FROM ${TABLE.CUSTOMER_ADDRESS} a
                        WHERE a.oid = $1
                          FOR UPDATE`,
                values: [oid],
            });
            if (!current) fail(404, "That address no longer exists.");
            if (current.status !== "Active") fail(409, "This address was already removed.", { status: current.status });

            const retired = await tx.execute_value({
                text: `UPDATE ${TABLE.CUSTOMER_ADDRESS} SET status = 'Inactive', is_default = false, edited_by = $2, edited_on = clock_timestamp() WHERE oid = $1 AND status = 'Active'`,
                values: [oid, user_id],
            });
            if (retired.rowCount !== 1) fail(409, "This address changed while it was being removed. Reload and try again.");
            if (current.is_default) {
                await tx.execute_value({
                    text: `UPDATE ${TABLE.CUSTOMER_ADDRESS} SET is_default = true, edited_by = $2, edited_on = clock_timestamp()
                            WHERE oid = (SELECT oid FROM ${TABLE.CUSTOMER_ADDRESS} WHERE customer_oid = $1 AND status = 'Active' ORDER BY created_on DESC, oid LIMIT 1)`,
                    values: [current.customer_oid, user_id],
                });
            }
            await saveLogActivity({ reference_type: "customer", reference_oid: current.customer_oid, title: "Removed address", description: describe_address(current) }, { tx, request });
        });
        return res.status(200).json({ code: 200, message: "Address removed", data: { oid } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while removing address ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not remove the address. Try again in a moment." });
    }
};

module.exports = retire_customer_address;
