const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { end_sessions_for_login, request_context } = require("../../../../auth/auth-session");
const { record_sessions_ended } = require("../../../../auth/auth-event");
const { caller_for, lock_target, not_self, not_last_owner } = require("../utils/user-rules");

// Turning an account off has to end what it already has open, not only refuse its next sign-in.
const switch_user_status = async (request, res) => {
    const { oid, status } = request.body;
    try {
        const caller = await caller_for(request);
        await execute_transaction(async (tx) => {
            const target = await lock_target(tx, oid, caller);
            if (target.status === status) return;
            if (status === "Inactive") {
                not_self(target, caller, "turn off");
                await not_last_owner(tx, target, "turn off");
            }

            await tx.execute_value({ text: `UPDATE ${TABLE.LOGIN} SET status = $2, edited_by = $3, edited_on = clock_timestamp() WHERE oid = $1`, values: [oid, status, caller.user_id] });
            if (status === "Inactive") {
                const ended = await end_sessions_for_login(tx, { login_oid: oid, reason: "UserDeactivated", by: caller.user_id });
                await record_sessions_ended(tx, ended, { login_oid: oid, email: target.email, reason: "UserDeactivated", context: request_context(request) });
            }
            await saveLogActivity({ reference_type: "user", reference_oid: oid, title: status === "Active" ? "Turned user on" : "Turned user off", description: target.name }, { tx, request });
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while switching user ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not change this person's access. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: status === "Active" ? "User turned on" : "User turned off", data: { oid, status } });
};

module.exports = switch_user_status;
