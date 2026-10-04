const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Watch or Blocked with a reason, or back to None (sales REQ-71). The business decides; the flag
// only makes sure nobody taking the next order misses it.
const flag_customer = async (request, res) => {
    const { oid, flag } = request.body;
    const reason = flag === "None" ? null : request.body.reason;
    try {
        const changed = await execute_transaction(async (tx) => {
            const [current] = await tx.get_data({ text: `SELECT name, flag, flag_reason FROM ${TABLE.CUSTOMERS} WHERE oid = $1 FOR UPDATE`, values: [oid] });
            if (!current) fail(404, "That customer no longer exists.");
            if (current.flag === flag && (current.flag_reason ?? null) === reason) return false;

            await tx.execute_value({
                text: `UPDATE ${TABLE.CUSTOMERS} SET flag = $2, flag_reason = $3, edited_by = $4, edited_on = clock_timestamp() WHERE oid = $1`,
                values: [oid, flag, reason, request.credentials.user_id],
            });
            await saveLogActivity(
                { reference_type: "customer", reference_oid: oid, title: flag === "None" ? "Removed flag" : `Flagged ${flag}`, description: flag === "None" ? `Was ${current.flag}` : reason },
                { tx, request }
            );
            return true;
        });

        if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });
        return res.status(200).json({ code: 200, message: flag === "None" ? "Flag removed" : `Customer flagged ${flag}`, data: { changed: true, flag } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while flagging customer ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not save the flag. Try again in a moment." });
    }
};

module.exports = flag_customer;
