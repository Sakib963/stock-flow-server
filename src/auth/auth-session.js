const crypto = require("crypto");
const JWT = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { TABLE, TEXT, CONTEXTS } = require("../utils/constant");
const { execute_value } = require("../db/database");
const { client_ip } = require("../middleware/rate-limit");

// Sessions, tokens and how the refresh token travels. Controllers decide what should happen; this
// is how it is done, so every auth endpoint issues and ends sessions the same way.
//
// The refresh token is 32 random bytes and deliberately not a JWT: its only job is to be looked up,
// and once the database decides whether it is valid, an expiry baked into the token adds nothing.
// It is stored as SHA-256. bcrypt exists to slow down guessing of low-entropy passwords, and 256
// random bits cannot be guessed.

const REFRESH_COOKIE = "sf_rt";
const RETENTION_DAYS = 90;
const UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

const duration_seconds = (value, fallback) => {
    const match = /^(\d+)\s*([smhd]?)$/.exec(String(value ?? "").trim());
    return match ? Number(match[1]) * UNITS[match[2] || "s"] : fallback;
};

const auth_config = () => ({
    access_seconds: duration_seconds(process.env.ACCESS_TOKEN_SECRET_EXPIRE, 15 * 60),
    refresh_idle_seconds: duration_seconds(process.env.REFRESH_TOKEN_SECRET_EXPIRE, 7 * 86400),
    session_max_seconds: duration_seconds(process.env.SESSION_MAX_AGE, 30 * 86400),
    reuse_grace_seconds: duration_seconds(process.env.REFRESH_REUSE_GRACE_SECONDS, 30),
    // The cookie needs the web app and the API on the same site. Hosting that cannot offer that
    // (two *.vercel.app addresses, a github.io page) uses 'body', which hands the token to the web
    // app instead. The web app follows whichever the server announces, so moving to same-site
    // hosting is this one setting and no code.
    transport: process.env.AUTH_REFRESH_TRANSPORT === "body" ? "body" : "cookie",
    cookie_secure: process.env.AUTH_COOKIE_SECURE !== "false",
});

const hash_token = (raw) => crypto.createHash("sha256").update(String(raw)).digest("hex");

const normalize_email = (email) => String(email ?? "").trim().toLowerCase();

const request_context = (request) => ({
    ip_address: client_ip(request).slice(0, 64) || null,
    user_agent: String(request.headers["user-agent"] ?? "").slice(0, 512) || null,
});

const sign_access_token = ({ login_oid, session_oid }) =>
    JWT.sign({ sid: session_oid }, process.env.ACCESS_TOKEN_SECRET, {
        subject: login_oid,
        expiresIn: auth_config().access_seconds,
        algorithm: TEXT.ALGORITHM,
    });

const verify_access_token = (token, { ignore_expiration = false } = {}) => {
    const claims = JWT.verify(token, process.env.ACCESS_TOKEN_SECRET, { algorithms: [TEXT.ALGORITHM], ignoreExpiration: ignore_expiration });
    if (typeof claims?.sub !== "string" || typeof claims?.sid !== "string") {
        throw new JWT.JsonWebTokenError("access token is missing its subject or session");
    }
    return claims;
};

const issue_refresh_token = async (tx, { session_oid, by }) => {
    const raw = crypto.randomBytes(32).toString("base64url");
    const oid = uuidv4();
    await tx.execute_value({
        text: `INSERT INTO ${TABLE.AUTH_REFRESH_TOKEN} (oid, session_oid, token_hash, status, expires_on, created_by)
               VALUES ($1, $2, $3, 'Active', LOCALTIMESTAMP + make_interval(secs => $4), $5)`,
        values: [oid, session_oid, hash_token(raw), auth_config().refresh_idle_seconds, by],
    });
    return { oid, raw };
};

const open_session = async (tx, { login_oid, email, remember, context }) => {
    const session_oid = uuidv4();
    await tx.execute_value({
        text: `INSERT INTO ${TABLE.AUTH_SESSION} (oid, login_oid, status, remember, ip_address, user_agent, last_used_on, expires_on, created_by)
               VALUES ($1, $2, 'Active', $3, $4, $5, LOCALTIMESTAMP, LOCALTIMESTAMP + make_interval(secs => $6), $7)`,
        values: [session_oid, login_oid, remember, context.ip_address, context.user_agent, auth_config().session_max_seconds, email],
    });
    const refresh = await issue_refresh_token(tx, { session_oid, by: email });
    return { session_oid, refresh_token: refresh.raw };
};

const end_where = async (tx, { clause, values, reason, by }) => {
    const status = reason === "SignOut" ? "SignedOut" : reason === "Expired" ? "Expired" : "Revoked";
    const n = values.length;
    const ended = await tx.execute_value({
        text: `UPDATE ${TABLE.AUTH_SESSION}
               SET status = $${n + 1}, end_reason = $${n + 2}, ended_on = LOCALTIMESTAMP, edited_by = $${n + 3}, edited_on = LOCALTIMESTAMP
               WHERE status = 'Active' AND ${clause}
               RETURNING oid, login_oid, user_agent`,
        values: [...values, status, reason, by],
    });

    const oids = ended.rows.map((row) => row.oid);
    if (oids.length) {
        await tx.execute_value({
            text: `UPDATE ${TABLE.AUTH_REFRESH_TOKEN} SET status = 'Revoked', edited_by = $2, edited_on = LOCALTIMESTAMP
                   WHERE session_oid = ANY($1::varchar[]) AND status = 'Active'`,
            values: [oids, by],
        });
    }
    return ended.rows;
};

/** Ends one session if it is still open. Returns the ended row, or null if it was already over. */
const end_session = async (tx, { session_oid, reason, by }) => (await end_where(tx, { clause: "oid = $1", values: [session_oid], reason, by }))[0] ?? null;

/** Ends one session only if it belongs to this account, so a session id alone is never enough. */
const end_own_session = async (tx, { session_oid, login_oid, reason, by }) => (await end_where(tx, { clause: "oid = $1 AND login_oid = $2", values: [session_oid, login_oid], reason, by }))[0] ?? null;

/** Ends every open session of an account, optionally sparing the one making the request. */
const end_sessions_for_login = (tx, { login_oid, reason, by, except_session_oid = null }) =>
    end_where(tx, { clause: "login_oid = $1 AND ($2::varchar IS NULL OR oid <> $2)", values: [login_oid, except_session_oid], reason, by });

const cookie_options = (remember) => {
    const { cookie_secure, refresh_idle_seconds } = auth_config();
    return {
        httpOnly: true,
        secure: cookie_secure,
        sameSite: "strict",
        // Sent to sign-in, refresh and sign-out only, never with ordinary API calls.
        path: CONTEXTS.AUTH,
        // Not kept signed in means a browser-session cookie: no Max-Age at all.
        ...(remember ? { maxAge: refresh_idle_seconds * 1000 } : {}),
    };
};

const read_cookie = (request, name) => {
    for (const part of String(request.headers.cookie ?? "").split(";")) {
        const at = part.indexOf("=");
        if (at > 0 && part.slice(0, at).trim() === name) {
            try {
                return decodeURIComponent(part.slice(at + 1).trim());
            } catch {
                return null;
            }
        }
    }
    return null;
};

// Only the configured transport is accepted. A cookie deployment never takes a token from a request
// body, because a token JavaScript could read is exactly what the cookie exists to prevent.
const read_refresh_token = (request) => {
    if (auth_config().transport === "body") {
        const token = request.body?.refresh_token;
        return typeof token === "string" && token ? token : null;
    }
    return read_cookie(request, REFRESH_COOKIE);
};

const clear_refresh_token = (res) => {
    if (auth_config().transport === "cookie") res.clearCookie(REFRESH_COOKIE, cookie_options(false));
};

/** The response data for a new access token, plus the refresh token in whichever way it travels. */
const grant_tokens = (res, { login_oid, session_oid, refresh_token, remember }) => {
    const { transport, access_seconds } = auth_config();
    const grant = { access_token: sign_access_token({ login_oid, session_oid }), expires_in: access_seconds, session_id: session_oid, refresh_transport: transport };

    if (transport === "cookie") res.cookie(REFRESH_COOKIE, refresh_token, cookie_options(remember));
    else grant.refresh_token = refresh_token;

    return grant;
};

// Opportunistic, like request_throttle: no scheduled job exists to do it. Renewal events are the
// bulk of the table and lose their value quickly; sign-ins, failures and revocations are kept.
const prune_auth_records = async () => {
    await execute_value({
        text: `DELETE FROM ${TABLE.AUTH_EVENT}
               WHERE event_type IN ('TOKEN_REFRESH', 'REFRESH_REJECTED') AND created_on < LOCALTIMESTAMP - make_interval(days => $1)`,
        values: [RETENTION_DAYS],
    });
    await execute_value({
        text: `DELETE FROM ${TABLE.AUTH_SESSION}
               WHERE (status <> 'Active' AND ended_on < LOCALTIMESTAMP - make_interval(days => $1))
                  OR expires_on < LOCALTIMESTAMP - make_interval(days => $1)`,
        values: [RETENTION_DAYS],
    });
};

module.exports = {
    REFRESH_COOKIE,
    auth_config,
    hash_token,
    normalize_email,
    request_context,
    sign_access_token,
    verify_access_token,
    issue_refresh_token,
    open_session,
    end_session,
    end_own_session,
    end_sessions_for_login,
    read_refresh_token,
    clear_refresh_token,
    grant_tokens,
    prune_auth_records,
};
