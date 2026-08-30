const bcrypt = require("bcrypt");
const { TABLE } = require("../../../utils/constant");
const { execute_transaction, execute_value, fail } = require("../../../utils/database");
const { log } = require("../../../utils/log");
const { saveLogActivity } = require("../../../utils/activity-logger");
const send_email = require("../../../utils/send-email");
const { render_email } = require("../../../utils/render-email");
const { check_rate_limit, client_ip } = require("../../../utils/rate-limit");

// A 6 digit code is a million guesses. Behind a token that is defensible; on an open endpoint it
// is not, so every wrong answer is counted and the code dies at the cap.
const MAX_ATTEMPTS = 5;

// The per-code cap dies with its code. This one survives across codes, so guessing cannot be
// continued by requesting a fresh one, and it applies even when the email is unknown.
const MAX_ATTEMPTS_PER_IP = 20;
const IP_WINDOW_MINUTES = 15;

const reset_password = async (request, res) => {
    const email = String(request.body.email || "").trim().toLowerCase();
    const { otp, new_password } = request.body;

    try {
        const ip = await check_rate_limit({
            bucket: "reset-password-ip",
            identifier: client_ip(request),
            limit: MAX_ATTEMPTS_PER_IP,
            window_minutes: IP_WINDOW_MINUTES,
        });
        if (!ip.allowed) {
            res.set("Retry-After", String(ip.retry_after_seconds));
            return res.status(429).json({ code: 429, message: "Too many attempts. Wait a few minutes and try again." });
        }

        const result = await execute_transaction(async (tx) => {
            const users = await tx.get_data({
                text: `SELECT l.email, l.name FROM ${TABLE.LOGIN} l WHERE LOWER(l.email) = $1`,
                values: [email],
            });
            const user = users[0];

            // forgot-password already says plainly when an address has no account, so pretending
            // otherwise here would only be confusing.
            if (!user) fail(404, "No account found with that email address. Check the spelling, or ask your shop admin.");

            const codes = await tx.get_data({
                text: `SELECT oid, otp, attempts, expires_at FROM ${TABLE.OTP_LOG}
                       WHERE user_id = $1 AND status = 'Active'
                       ORDER BY created_on DESC LIMIT 1`,
                values: [user.email],
            });
            const code = codes[0];

            if (!code) fail(404, "That code has expired. Send a new one.");
            if (new Date(code.expires_at) <= new Date()) {
                await tx.execute_value({
                    text: `UPDATE ${TABLE.OTP_LOG} SET status = 'Inactive' WHERE oid = $1`,
                    values: [code.oid],
                });
                fail(404, "That code has expired. Send a new one.");
            }

            if (code.attempts >= MAX_ATTEMPTS) {
                await tx.execute_value({
                    text: `UPDATE ${TABLE.OTP_LOG} SET status = 'Inactive' WHERE oid = $1`,
                    values: [code.oid],
                });
                fail(429, "Too many incorrect codes. Start again to get a new one.");
            }

            if (code.otp !== String(otp)) {
                // The count has to survive the rollback that `fail` triggers, so it is written
                // after the transaction instead. See below.
                fail(404, "That code is not right. Check the email and try again.", {
                    wrong_code_oid: code.oid,
                });
            }

            const encrypted = await bcrypt.hash(new_password, 10);
            await tx.execute_value({
                text: `UPDATE ${TABLE.LOGIN} SET password = $1 WHERE email = $2`,
                values: [encrypted, user.email],
            });

            // Spend the code, and any other live one for this user.
            await tx.execute_value({
                text: `UPDATE ${TABLE.OTP_LOG} SET status = 'Inactive' WHERE user_id = $1 AND status = 'Active'`,
                values: [user.email],
            });

            return user;
        });

        saveLogActivity({
            reference_type: "auth",
            reference_oid: result.email,
            title: "Password reset",
            description: "Password was reset using an emailed code.",
            performed_by: result.email,
        });

        // Fire and forget: the password is already changed, and a mail failure must not turn a
        // successful reset into an error the user will retry.
        notify_password_changed(result).catch((e) => log.error(`Failed to send password-changed email: ${e?.message}`));

        log.info(`Password reset completed for user: ${result.email}`);
        return res.status(200).json({ code: 200, message: "Your password has been changed. Sign in with the new one.", data: null });
    } catch (e) {
        // A wrong code still has to be counted, and the transaction that detected it was rolled
        // back. This runs on its own so the tally cannot be reset by simply retrying.
        if (e?.data?.wrong_code_oid) {
            await count_failed_attempt(e.data.wrong_code_oid);
        }

        if (e?.code && e?.message) {
            return res.status(e.code).json({ code: e.code, message: e.message });
        }

        log.error(`An exception occurred while resetting the password: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something went wrong! Please try again later!" });
    }
};

const count_failed_attempt = async (otp_oid) => {
    try {
        await execute_value({
            text: `UPDATE ${TABLE.OTP_LOG} SET attempts = attempts + 1 WHERE oid = $1`,
            values: [otp_oid],
        });
    } catch (e) {
        log.error(`Failed to record a wrong reset code attempt: ${e?.message}`);
    }
};

// The tripwire that tells a real owner their account was taken over, so it matters more than it
// looks. It reports only: no code, and no link that performs anything.
const notify_password_changed = async (user) => {
    const email = render_email(__dirname, "password_changed_template", {
        USER_NAME: user.name || "there",
        // The template calls this CURRENT_DATE, and shows it as the moment of the change.
        CURRENT_DATE: new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }),
    });

    await send_email({ to: user.email, subject: email.subject, text: email.text, html: email.html });
};

module.exports = reset_password;
