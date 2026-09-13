const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("./constant");
const { execute_value } = require("./database");
const { log } = require("./log");

const AUTH_EVENT = Object.freeze({
    LOGIN_SUCCESS: "LOGIN_SUCCESS",
    LOGIN_FAILED: "LOGIN_FAILED",
    LOGOUT: "LOGOUT",
    TOKEN_REFRESH: "TOKEN_REFRESH",
    REFRESH_REJECTED: "REFRESH_REJECTED",
    REFRESH_TOKEN_REUSE: "REFRESH_TOKEN_REUSE",
    SESSION_REVOKED: "SESSION_REVOKED",
});

// Only these keys reach `detail`. The allow-list is what guarantees a token can never be written
// into the audit trail by accident, rather than trusting every caller to remember.
const DETAIL_KEYS = ["reason", "grace"];

const event_query = ({ event_type, login_oid = null, session_oid = null, email = null, context = {}, detail = null }) => {
    const kept = Object.fromEntries(Object.entries(detail ?? {}).filter(([key]) => DETAIL_KEYS.includes(key)));
    return {
        text: `INSERT INTO ${TABLE.AUTH_EVENT} (oid, event_type, login_oid, session_oid, email, ip_address, user_agent, detail)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        values: [uuidv4(), event_type, login_oid, session_oid, email ? String(email).slice(0, 256) : null, context.ip_address ?? null, context.user_agent ?? null, Object.keys(kept).length ? JSON.stringify(kept) : null],
    };
};

/** Inside a transaction, so the event commits or rolls back with the change it describes. */
const record_auth_event_in = (tx, event) => tx.execute_value(event_query(event));

/**
 * For outcomes with nothing else to write, such as a failed sign-in. Awaited rather than fired and
 * forgotten, because a serverless function can be frozen the moment it answers. Never throws: a
 * failed audit write must not turn a correct answer into a 500.
 */
const record_auth_event = async (event) => {
    try {
        await execute_value(event_query(event));
    } catch (e) {
        log.error(`Failed to record auth event ${event.event_type}: ${e?.message}`);
    }
};

const record_sessions_ended = async (tx, rows, { login_oid, email, reason, context }) => {
    for (const row of rows) {
        await record_auth_event_in(tx, { event_type: AUTH_EVENT.SESSION_REVOKED, login_oid: login_oid ?? row.login_oid, session_oid: row.oid, email, context, detail: { reason } });
    }
};

module.exports = { AUTH_EVENT, record_auth_event, record_auth_event_in, record_sessions_ended };
