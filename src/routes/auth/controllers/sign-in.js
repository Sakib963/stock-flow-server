const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { TABLE } = require("../../../utils/constant");
const { get_data, execute_transaction } = require("../../../utils/database");
const { log } = require("../../../utils/log");
const { check_rate_limit } = require("../../../utils/rate-limit");
const { open_session, end_session, end_own_session, grant_tokens, hash_token, read_refresh_token, request_context, normalize_email, prune_auth_records } = require("../../../utils/auth-session");
const { AUTH_EVENT, record_auth_event, record_auth_event_in } = require("../../../utils/auth-event");

// Several staff at one counter share an address, so the IP limit is loose. The email limit is the
// one that stops guessing at a single account.
const LIMITS = [
    { bucket: "sign-in-ip", by: "ip", limit: 30, window_minutes: 15 },
    { bucket: "sign-in-email", by: "email", limit: 10, window_minutes: 15 },
];

// Compared against when no account matches, so a wrong email costs the same time as a wrong
// password and response time does not reveal which addresses have accounts.
const DECOY_HASH = bcrypt.hashSync(crypto.randomBytes(18).toString("hex"), 10);

const sign_in = async (request, res) => {
    const email = normalize_email(request.body.email);
    const password = String(request.body.password);
    const remember = request.body.remember === true;
    const context = request_context(request);

    try {
        for (const { bucket, by, limit, window_minutes } of LIMITS) {
            const verdict = await check_rate_limit({ bucket, identifier: by === "email" ? email : context.ip_address, limit, window_minutes });
            if (!verdict.allowed) {
                res.set("Retry-After", String(verdict.retry_after_seconds));
                return res.status(429).json({ code: 429, message: "Too many sign-in attempts. Wait a few minutes and try again." });
            }
        }

        const users = await get_data({
            text: `SELECT l.oid, l.email, l.name, l.password, l.status, r.name AS role_name
                   FROM ${TABLE.LOGIN} l
                   LEFT JOIN ${TABLE.ROLE} r ON r.oid = l.role_oid
                   WHERE LOWER(l.email) = $1`,
            values: [email],
        });
        const user = users[0];
        const matched = await bcrypt.compare(password, user?.password ?? DECOY_HASH);

        if (!user || !matched) {
            await record_auth_event({ event_type: AUTH_EVENT.LOGIN_FAILED, login_oid: user?.oid, email, context, detail: { reason: user ? "password" : "unknown_email" } });
            log.warn(`Sign in rejected: credentials did not match`);
            return res.status(401).json({ code: 401, message: "Email or password is incorrect." });
        }

        // Only reachable with the right password, so saying the account is off tells a guesser nothing.
        if (user.status !== "Active") {
            await record_auth_event({ event_type: AUTH_EVENT.LOGIN_FAILED, login_oid: user.oid, email: user.email, context, detail: { reason: "inactive" } });
            return res.status(403).json({ code: 403, message: "This account is turned off. Ask your organisation's admin to turn it back on." });
        }

        const session = await execute_transaction(async (tx) => {
            await end_replaced_sessions(tx, { raw: read_refresh_token(request), previous_session_id: request.body.previous_session_id || null, user, context });
            const opened = await open_session(tx, { login_oid: user.oid, email: user.email, remember, context });
            await record_auth_event_in(tx, { event_type: AUTH_EVENT.LOGIN_SUCCESS, login_oid: user.oid, session_oid: opened.session_oid, email: user.email, context });
            return opened;
        });

        if (Math.random() < 0.02) prune_auth_records().catch((e) => log.error(`Pruning auth records failed: ${e?.message}`));

        log.info(`Sign in successful for user: ${user.email}`);
        return res.status(200).json({
            code: 200,
            message: "Sign-in successful",
            data: {
                ...grant_tokens(res, { login_oid: user.oid, session_oid: session.session_oid, refresh_token: session.refresh_token, remember }),
                user: { id: user.oid, email: user.email, name: user.name, role: user.role_name },
            },
        });
    } catch (e) {
        log.error(`An exception occurred while signing in: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something went wrong. Please try again later." });
    }
};

/**
 * Ends the session this browser held before, so signing in again replaces it instead of adding a
 * second one that stays listed as a device nobody can reach.
 *
 * Two ways to find it, and only a correct password gets this far. The refresh token the browser
 * still carries names it whichever account it belonged to: holding the token is what authorises
 * ending it, exactly as at sign-out. When the token is already gone, as with a not-kept session in
 * a browser that was closed, the web app still remembers the id of the last session it held. That
 * ends it only if it belongs to the account that just proved its password, so an id alone can
 * never end anyone else's session.
 */
const end_replaced_sessions = async (tx, { raw, previous_session_id, user, context }) => {
    const replaced = async (ended, session_oid, email) => {
        if (ended) await record_auth_event_in(tx, { event_type: AUTH_EVENT.LOGOUT, login_oid: ended.login_oid, session_oid, email, context, detail: { reason: "replaced" } });
    };

    if (raw) {
        const [held] = await tx.get_data({
            text: `SELECT s.oid, l.email
                   FROM ${TABLE.AUTH_REFRESH_TOKEN} t
                   JOIN ${TABLE.AUTH_SESSION} s ON s.oid = t.session_oid
                   JOIN ${TABLE.LOGIN} l ON l.oid = s.login_oid
                   WHERE t.token_hash = $1`,
            values: [hash_token(raw)],
        });
        if (held) await replaced(await end_session(tx, { session_oid: held.oid, reason: "SignOut", by: held.email }), held.oid, held.email);
    }

    if (previous_session_id) {
        await replaced(await end_own_session(tx, { session_oid: previous_session_id, login_oid: user.oid, reason: "SignOut", by: user.email }), previous_session_id, user.email);
    }
};

module.exports = sign_in;
