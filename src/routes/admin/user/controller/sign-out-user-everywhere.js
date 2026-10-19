const { execute_transaction, TransactionError } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { end_sessions_for_login, request_context, count_live } = require("../../../../auth/auth-session");
const { record_sessions_ended } = require("../../../../auth/auth-event");
const { caller_for, lock_target, not_self } = require("../utils/user-rules");

// For a lost phone or someone leaving: every device of the account is signed out, the account stays on.
const sign_out_user_everywhere = async (request, res) => {
    const { oid } = request.body;
    let devices = 0;
    try {
        const caller = await caller_for(request);
        await execute_transaction(async (tx) => {
            const target = await lock_target(tx, oid, caller);
            not_self(target, caller, "sign out from here");
            const ended = await end_sessions_for_login(tx, { login_oid: oid, reason: "RemoteSignOut", by: caller.user_id });
            await record_sessions_ended(tx, ended, { login_oid: oid, email: target.email, reason: "RemoteSignOut", context: request_context(request) });
            devices = count_live(ended);
            await saveLogActivity({ reference_type: "user", reference_oid: oid, title: "Signed out everywhere", description: `${target.name}, ${devices} device${devices === 1 ? "" : "s"}` }, { tx, request });
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while signing user ${oid} out everywhere: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not sign this person out. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: "Signed out everywhere", data: { oid, devices } });
};

module.exports = sign_out_user_everywhere;
