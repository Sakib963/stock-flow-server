const bcrypt = require("bcrypt");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, fail, TransactionError } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { check_rate_limit } = require("../../../../middleware/rate-limit");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { end_sessions_for_login, request_context } = require("../../../../auth/auth-session");
const { record_sessions_ended } = require("../../../../auth/auth-event");

// The first sign-in of an account someone else created. The temporary password proves the person, so
// no emailed code is needed, and setting their own clears the block every other request meets.
const set_first_password = async (request, res) => {
    const { current_password, new_password } = request.body;
    const { user_id, login_oid, session_oid } = request.credentials;
    try {
        const verdict = await check_rate_limit({ bucket: "set-first-password", identifier: user_id, limit: 5, window_minutes: 15 });
        if (!verdict.allowed) {
            res.set("Retry-After", String(verdict.retry_after_seconds));
            return res.status(429).json({ code: 429, message: "Too many tries. Wait a few minutes and try again." });
        }

        await execute_transaction(async (tx) => {
            const [login] = await tx.get_data({ text: `SELECT password, must_change_password FROM ${TABLE.LOGIN} WHERE oid = $1 FOR UPDATE`, values: [login_oid] });
            if (!login?.must_change_password) fail(400, "Your password is already set. To change it, use Change password on your profile.");
            if (!(await bcrypt.compare(current_password, login.password))) fail(400, "That is not the temporary password you were given. Check it and try again.", { field: "current_password" });
            if (new_password === current_password) fail(400, "Choose a password different from the temporary one.", { field: "new_password" });

            await tx.execute_value({
                text: `UPDATE ${TABLE.LOGIN} SET password = $1, must_change_password = false, edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3`,
                values: [await bcrypt.hash(new_password, 10), user_id, login_oid],
            });
            const ended = await end_sessions_for_login(tx, { login_oid, reason: "PasswordChanged", by: user_id, except_session_oid: session_oid });
            await record_sessions_ended(tx, ended, { login_oid, email: user_id, reason: "PasswordChanged", context: request_context(request) });
            await saveLogActivity({ reference_type: "user", reference_oid: login_oid, title: "Set their own password", description: "Replaced the temporary password on first sign-in." }, { tx, request });
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, ...(e.data?.field && { data: { field: e.data.field } }) });
        log.error(`An exception occurred while setting a first password: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Your password was not set. Try again in a moment." });
    }
    return res.status(200).json({ code: 200, message: "Your password is set." });
};

module.exports = set_first_password;
