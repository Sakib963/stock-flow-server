const { TABLE } = require("../utils/constant");
const { get_data } = require("../db/database");
const { log } = require("../utils/log");
const { verify_access_token } = require("../auth/auth-session");

// A valid signature only proves this server issued the token. The session it names must also still
// be open, for an account that is still active. That second check is one primary-key read, and it
// is what makes signing out, sign out everywhere and turning an account off take effect on the
// next request instead of whenever the token happens to expire.
//
// `user_id` stays the email because requirePermission and every controller read it.

const MESSAGES = {
    missing: "Sign in to continue.",
    invalid: "Sign in to continue.",
    expired: "Your access has expired.",
    ended: "This session has ended. Sign in again.",
};

const unauthorized = (res, reason) => res.status(401).json({ code: 401, message: MESSAGES[reason], data: { reason } });

const jwtMiddleware = async (request, res, next) => {
    const header = request.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) return unauthorized(res, "missing");

    let claims;
    try {
        claims = verify_access_token(header.slice(7).trim());
    } catch (e) {
        return unauthorized(res, e?.name === "TokenExpiredError" ? "expired" : "invalid");
    }

    try {
        const rows = await get_data({
            text: `SELECT l.email
                   FROM ${TABLE.AUTH_SESSION} s
                   JOIN ${TABLE.LOGIN} l ON l.oid = s.login_oid
                   WHERE s.oid = $1 AND s.login_oid = $2
                     AND s.status = 'Active' AND s.expires_on > LOCALTIMESTAMP
                     AND l.status = 'Active'`,
            values: [claims.sid, claims.sub],
        });
        if (!rows.length) return unauthorized(res, "ended");

        request.credentials = { user_id: rows[0].email, login_oid: claims.sub, session_oid: claims.sid };
        return next();
    } catch (e) {
        log.error(`An exception occurred while validating a session: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something went wrong. Please try again." });
    }
};

module.exports = jwtMiddleware;
