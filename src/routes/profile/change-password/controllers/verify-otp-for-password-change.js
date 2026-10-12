const bcrypt = require("bcrypt");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, execute_value, fail, TransactionError } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { end_sessions_for_login, request_context } = require("../../../../auth/auth-session");
const { record_sessions_ended } = require("../../../../auth/auth-event");

// Five wrong codes and the code is spent, as on password reset: a million guesses is not a
// defence on its own, even behind a sign-in.
const MAX_ATTEMPTS = 5;

// The emailed code proves the change, then the password changes and every other device is signed
// out, in one transaction with the code spent, so two presses cannot both use it. The device
// making the change stays signed in (decided 2026-09-11).
const verify_otp_for_password_change = async (request, res) => {
    const { otp, otp_oid, new_password } = request.body;
    const { user_id, login_oid, session_oid } = request.credentials;

    try {
        const sessions_closed = await execute_transaction(async (tx) => {
            const [code] = await tx.get_data({
                text: `SELECT oid, otp, attempts, expires_at > NOW() AS live FROM ${TABLE.OTP_LOG} WHERE oid = $1 AND user_id = $2 AND status = 'Active' FOR UPDATE`,
                values: [otp_oid, user_id],
            });
            if (!code || !code.live) fail(404, "That code has expired. Start again to get a new one.");
            if (code.attempts >= MAX_ATTEMPTS) fail(429, "Too many incorrect codes. Start again to get a new one.");
            // The count has to survive the rollback `fail` causes, so it is written after the transaction.
            if (code.otp !== String(otp)) fail(400, "That code is not right. Check the email and try again.", { wrong_code_oid: code.oid });

            await tx.execute_value({ text: `UPDATE ${TABLE.OTP_LOG} SET status = 'Inactive' WHERE user_id = $1 AND status = 'Active'`, values: [user_id] });
            await tx.execute_value({
                text: `UPDATE ${TABLE.LOGIN} SET password = $1, edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3`,
                values: [await bcrypt.hash(new_password, 10), user_id, login_oid],
            });
            const ended = await end_sessions_for_login(tx, { login_oid, reason: "PasswordChanged", by: user_id, except_session_oid: session_oid });
            await record_sessions_ended(tx, ended, { login_oid, email: user_id, reason: "PasswordChanged", context: request_context(request) });
            await saveLogActivity({ reference_type: "auth", reference_oid: user_id, title: "Password changed", description: `Changed with an emailed code; ${ended.length} other device${ended.length === 1 ? "" : "s"} signed out.` }, { tx, request });
            return ended.length;
        });

        log.info(`Password changed by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Your password has been changed.", data: { sessions_closed } });
    } catch (e) {
        if (e?.data?.wrong_code_oid) await count_failed_attempt(e.data.wrong_code_oid);
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while changing a password: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The password was not changed. Try again in a moment." });
    }
};

const count_failed_attempt = async (otp_oid) => {
    try {
        await execute_value({ text: `UPDATE ${TABLE.OTP_LOG} SET attempts = attempts + 1 WHERE oid = $1`, values: [otp_oid] });
    } catch (e) {
        log.error(`Failed to record a wrong password change code: ${e?.message}`);
    }
};

module.exports = verify_otp_for_password_change;
