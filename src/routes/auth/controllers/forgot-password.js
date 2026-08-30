const { TABLE } = require("../../../utils/constant");
const { get_data } = require("../../../utils/database");
const { save_generated_otp, count_recent_otps, OTP_TTL_MINUTES } = require("../../../utils/helper");
const { log } = require("../../../utils/log");
const send_email = require("../../../utils/send-email");
const { render_email } = require("../../../utils/render-email");
const { check_rate_limit, client_ip } = require("../../../utils/rate-limit");

// A person who has forgotten their password has no token, so this route is deliberately open.
// Everything below exists because of that.
const MAX_SENDS_PER_WINDOW = 3;
const SEND_WINDOW_MINUTES = 15;

// The per-email throttle stops one address being spammed. This one stops a single machine walking
// a list of addresses, which the per-email limit cannot see because each address looks like a
// first request. Set above the email limit so an ordinary person retrying never meets it.
const MAX_SENDS_PER_IP = 10;
const IP_WINDOW_MINUTES = 15;

// An unknown address is told so, plainly.
//
// The usual advice is to answer identically whether or not the account exists, so the endpoint
// cannot be used to ask whether a given person is a user. That is the right default for consumer
// software with open registration. It is the wrong trade here: StockFlow is one deployment and one
// database per client, with a handful of provisioned staff accounts, so the fact being protected
// is small, while the cost is that a shopkeeper who mistypes their address waits for an email that
// is never coming and has no way to discover why.
//
// The rate limits above are what keep this from becoming a way to harvest addresses in bulk.
//
// The consequence to keep in mind: this route now confirms which addresses are real, which softens
// the sign-in screen's refusal to say whether the email or the password was wrong.
const NOT_FOUND_MESSAGE = "No account found with that email address. Check the spelling, or ask your shop admin.";

// expires_at lets the next screen count down from the server's clock rather than from page load:
// the user may walk to their phone and back.
const sent_response = () => ({
    code: 200,
    message: "A code is on its way.",
    data: {
        sent: true,
        expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString(),
    },
});

const forgot_password = async (request, res) => {
    const email = String(request.body.email || "").trim().toLowerCase();

    try {
        // Checked before the user lookup, so a throttled caller cannot use response timing to
        // learn whether the address exists.
        const ip = await check_rate_limit({
            bucket: "forgot-password-ip",
            identifier: client_ip(request),
            limit: MAX_SENDS_PER_IP,
            window_minutes: IP_WINDOW_MINUTES,
        });
        if (!ip.allowed) {
            res.set("Retry-After", String(ip.retry_after_seconds));
            return res.status(429).json({ code: 429, message: "Too many attempts. Wait a few minutes and try again." });
        }

        const user = await find_user(email);

        if (!user) {
            log.info(`Password reset requested for an address with no account`);
            return res.status(404).json({ code: 404, message: NOT_FOUND_MESSAGE });
        }

        const recent = await count_recent_otps(user.email, SEND_WINDOW_MINUTES);
        if (recent >= MAX_SENDS_PER_WINDOW) {
            // Throttled, and told so. This is the one case worth distinguishing: the person is
            // real, they are waiting, and silence would have them keep pressing the button.
            log.warn(`Password reset throttled for user: ${user.email}`);
            return res.status(429).json({
                code: 429,
                message: "Too many attempts. Wait a few minutes and try again.",
            });
        }

        const generated = await save_generated_otp(user.email);
        if (!generated?.otp) {
            return res.status(500).json({ code: 500, message: "Something went wrong! Please try again later!" });
        }

        await send_reset_code(user, generated.otp);
        log.info(`Password reset code sent for user: ${user.email}`);

        return res.status(200).json(sent_response());
    } catch (e) {
        log.error(`An exception occurred while starting password recovery: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something went wrong! Please try again later!" });
    }
};

const find_user = async (email) => {
    const sql = {
        text: `SELECT l.email, l.name FROM ${TABLE.LOGIN} l WHERE LOWER(l.email) = $1`,
        values: [email],
    };
    const rows = await get_data(sql);
    return rows[0] || null;
};

const send_reset_code = async (user, otp) => {
    // Subject, HTML and plain text all come from the designed template pair in this folder, so
    // the copy is not split between a designer's file and a controller string.
    const email = render_email(__dirname, "reset_password_otp_template", {
        USER_NAME: user.name || "there",
        OTP: otp,
    });

    try {
        await send_email({ to: user.email, subject: email.subject, text: email.text, html: email.html });
    } catch (e) {
        log.error(`An exception occurred while sending the reset code: ${e?.message}`);
        throw new Error("Failed to send reset code email");
    }
};

module.exports = forgot_password;
