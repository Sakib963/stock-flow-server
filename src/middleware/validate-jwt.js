const { get_data } = require("../db/database");
const { log } = require("../utils/log");
const { verify_access_token } = require("../auth/auth-session");
const { TABLE, CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../utils/constant");
const { REFERENCE_VERSION_SQL } = require("../utils/config-version");

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

// An account someone else created answers only these until its person sets their own password, so a
// hand-written request gets no further than the page does. Signing out needs no session at all.
const BEFORE_FIRST_PASSWORD = new Set([CONTEXTS.AUTH + ROUTES.GET_USER_INFO, CONTEXTS.PROFILE + SUB_CONTEXTS.CHANGE_PASSWORD + ROUTES.SET_FIRST_PASSWORD]);

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
            // The permissions ride in this read, so requirePermission needs no query of its own.
            text: `SELECT l.email, l.must_change_password, (SELECT version FROM ${TABLE.CONFIG_VERSION} LIMIT 1) AS config_version, ${REFERENCE_VERSION_SQL} AS reference_version,
                          ARRAY(SELECT p.code FROM ${TABLE.ROLE} r
                                JOIN ${TABLE.ROLE_PERMISSION} rp ON rp.role_oid = r.oid
                                JOIN ${TABLE.PERMISSION} p ON p.oid = rp.permission_oid
                                WHERE r.oid = l.role_oid AND r.status = 'Active') AS permissions
                   FROM ${TABLE.AUTH_SESSION} s
                   JOIN ${TABLE.LOGIN} l ON l.oid = s.login_oid
                   WHERE s.oid = $1 AND s.login_oid = $2
                     AND s.status = 'Active' AND s.expires_on > LOCALTIMESTAMP
                     AND l.status = 'Active'`,
            values: [claims.sid, claims.sub],
        });
        if (!rows.length) return unauthorized(res, "ended");

        // Every signed-in answer names the config version it was served at, read in this same query, so
        // an open tab learns a role, menu or settings change on its next request and reloads its payload.
        res.set("X-Config-Version", String(rows[0].config_version ?? 0));
        res.set("X-Reference-Version", String(rows[0].reference_version ?? 0));
        if (rows[0].must_change_password && !BEFORE_FIRST_PASSWORD.has(request.baseUrl + request.path)) {
            return res.status(403).json({ code: 403, message: "Set your own password before you continue.", data: { reason: "must_change_password" } });
        }
        request.credentials = { user_id: rows[0].email, login_oid: claims.sub, session_oid: claims.sid, permissions: new Set(rows[0].permissions), config_version: rows[0].config_version ?? 0 };
        return next();
    } catch (e) {
        log.error(`An exception occurred while validating a session: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something went wrong. Please try again." });
    }
};

module.exports = jwtMiddleware;
