const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { end_sessions_for_login, request_context } = require("../../../../auth/auth-session");
const { record_sessions_ended } = require("../../../../auth/auth-event");
const { caller_for, lock_target, not_self, not_last_owner } = require("../utils/user-rules");

// Never removes the row: orders, returns and the activity log name the person by email, so the
// email stays taken. Final; someone who is only away is turned off instead.
const delete_user = async (request, res) => {
    const { oid } = request.body;
    try {
        const caller = await caller_for(request);
        await execute_transaction(async (tx) => {
            const target = await lock_target(tx, oid, caller);
            not_self(target, caller, "delete");
            await not_last_owner(tx, target, "delete");

            await tx.execute_value({ text: `UPDATE ${TABLE.LOGIN} SET status = 'Deleted', edited_by = $2, edited_on = clock_timestamp() WHERE oid = $1`, values: [oid, caller.user_id] });
            const ended = await end_sessions_for_login(tx, { login_oid: oid, reason: "UserDeactivated", by: caller.user_id });
            await record_sessions_ended(tx, ended, { login_oid: oid, email: target.email, reason: "UserDeactivated", context: request_context(request) });
            await saveLogActivity({ reference_type: "user", reference_oid: oid, title: "Deleted user", description: `${target.name} (${target.email})` }, { tx, request });
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while deleting user ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not delete this person. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: "User deleted", data: { oid } });
};

module.exports = delete_user;
