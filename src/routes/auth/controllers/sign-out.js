const { TABLE } = require("../../../utils/constant");
const { get_data, execute_transaction } = require("../../../utils/database");
const { log } = require("../../../utils/log");
const { hash_token, verify_access_token, end_session, read_refresh_token, clear_refresh_token, request_context } = require("../../../utils/auth-session");
const { AUTH_EVENT, record_auth_event_in } = require("../../../utils/auth-event");

/**
 * Ends the session in the database, not only in the browser.
 *
 * There is no jwtMiddleware: the usual moment to sign out is coming back to a tab after the access
 * token has lapsed, and the session still has to end. The session is found from the refresh token,
 * or failing that from the access token's session id with its signature checked and its expiry
 * ignored. Holding either is what authorises ending that session, and ending a session gains an
 * attacker nothing.
 *
 * The answer is 200 whatever was found. A session already over is what the caller asked for, and
 * an error here would strand someone on a screen they are trying to leave.
 */
const sign_out = async (request, res) => {
    const context = request_context(request);

    try {
        const found = await find_session(request);
        let sessions_closed = 0;

        if (found) {
            sessions_closed = await execute_transaction(async (tx) => {
                const ended = await end_session(tx, { session_oid: found.oid, reason: "SignOut", by: found.email });
                if (!ended) return 0;
                await record_auth_event_in(tx, { event_type: AUTH_EVENT.LOGOUT, login_oid: ended.login_oid, session_oid: found.oid, email: found.email, context });
                return 1;
            });
        }

        clear_refresh_token(res);
        log.info(`Sign out handled, sessions closed: ${sessions_closed}`);
        return res.status(200).json({ code: 200, message: "Signed out", data: { sessions_closed } });
    } catch (e) {
        log.error(`An exception occurred while signing out: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not end the session. Please try again." });
    }
};

const find_session = async (request) => {
    const raw = read_refresh_token(request);
    if (raw) {
        const rows = await get_data({
            text: `SELECT s.oid, l.email
                   FROM ${TABLE.AUTH_REFRESH_TOKEN} t
                   JOIN ${TABLE.AUTH_SESSION} s ON s.oid = t.session_oid
                   JOIN ${TABLE.LOGIN} l ON l.oid = s.login_oid
                   WHERE t.token_hash = $1`,
            values: [hash_token(raw)],
        });
        if (rows.length) return rows[0];
    }

    const header = request.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) return null;

    let claims;
    try {
        claims = verify_access_token(header.slice(7).trim(), { ignore_expiration: true });
    } catch {
        return null;
    }

    const rows = await get_data({
        text: `SELECT s.oid, l.email FROM ${TABLE.AUTH_SESSION} s JOIN ${TABLE.LOGIN} l ON l.oid = s.login_oid WHERE s.oid = $1 AND s.login_oid = $2`,
        values: [claims.sid, claims.sub],
    });
    return rows[0] ?? null;
};

module.exports = sign_out;
