const { TABLE } = require("../../../utils/constant");
const { execute_transaction, fail } = require("../../../utils/database");
const { log } = require("../../../utils/log");
const { auth_config, hash_token, issue_refresh_token, end_session, grant_tokens, clear_refresh_token, read_refresh_token, request_context } = require("../../../utils/auth-session");
const { AUTH_EVENT, record_auth_event, record_auth_event_in } = require("../../../utils/auth-event");

const MESSAGES = {
    missing: "Sign in to continue.",
    invalid: "Sign in to continue.",
    ended: "This session has ended. Sign in again.",
    expired: "This session has expired. Sign in again.",
    reuse: "This sign-in was used from somewhere else, so it was ended to keep the account safe. Sign in again.",
};

/**
 * Trades a refresh token for a new access token and a new refresh token.
 *
 * Every refresh token is single use. Presenting one that was already replaced means two parties
 * hold it, and there is no telling which is the owner, so the whole session ends. The one exception
 * is a token replaced seconds ago whose replacement nobody has used: that is an answer lost on a
 * bad connection, or two tabs renewing together, and ending the session there would sign honest
 * people out of a patchy counter connection.
 */
const refresh_token = async (request, res) => {
    const raw = read_refresh_token(request);
    const context = request_context(request);
    if (!raw) return refuse(res, "missing");

    try {
        const outcome = await execute_transaction((tx) => renew(tx, hash_token(raw), context));

        if (outcome.result !== "rotated") {
            if (outcome.result === "invalid") await record_auth_event({ event_type: AUTH_EVENT.REFRESH_REJECTED, context, detail: { reason: "invalid" } });
            log.warn(`Refresh refused: ${outcome.result}`);
            return refuse(res, outcome.result, outcome.ended_reason);
        }

        return res.status(200).json({ code: 200, message: "Session renewed", data: grant_tokens(res, outcome) });
    } catch (e) {
        if (e?.code && e?.message && e.no_retry) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while renewing a session: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something went wrong. Please try again." });
    }
};

// `ended_reason` says why a session that did exist ended, so the device can tell the person what
// happened and what to do. The caller holds that session's token, so it learns nothing new.
const refuse = (res, reason, ended_reason = null) => {
    clear_refresh_token(res);
    return res.status(401).json({ code: 401, message: MESSAGES[reason], data: { reason, ended_reason } });
};

const renew = async (tx, token_hash, context) => {
    const found = await tx.get_data({ text: `SELECT oid, session_oid FROM ${TABLE.AUTH_REFRESH_TOKEN} WHERE token_hash = $1`, values: [token_hash] });
    if (!found.length) return { result: "invalid" };
    const token_oid = found[0].oid;

    // Locking the session serialises every renewal inside it, which is what makes the token state
    // read below current rather than a snapshot another renewal is about to change.
    const [session] = await tx.get_data({
        text: `SELECT s.oid, s.login_oid, s.status, s.end_reason, s.remember, s.expires_on > LOCALTIMESTAMP AS live, l.email, l.status AS login_status
               FROM ${TABLE.AUTH_SESSION} s
               JOIN ${TABLE.LOGIN} l ON l.oid = s.login_oid
               WHERE s.oid = $1
               FOR UPDATE OF s`,
        values: [found[0].session_oid],
    });

    const event = (event_type, detail = null) => record_auth_event_in(tx, { event_type, login_oid: session.login_oid, session_oid: session.oid, email: session.email, context, detail });
    const end = async (reason, result) => {
        await end_session(tx, { session_oid: session.oid, reason, by: session.email });
        await event(AUTH_EVENT.SESSION_REVOKED, { reason });
        return { result, ended_reason: reason };
    };

    if (session.status !== "Active") {
        await event(AUTH_EVENT.REFRESH_REJECTED, { reason: "ended" });
        return { result: "ended", ended_reason: session.end_reason };
    }
    if (session.login_status !== "Active") return end("UserDeactivated", "ended");
    if (!session.live) return end("Expired", "expired");

    const [token] = await tx.get_data({
        text: `SELECT t.status,
                      t.expires_on > LOCALTIMESTAMP AS live,
                      COALESCE(t.rotated_on > LOCALTIMESTAMP - make_interval(secs => $2), false) AS in_grace,
                      n.oid AS successor_oid, n.status AS successor_status
               FROM ${TABLE.AUTH_REFRESH_TOKEN} t
               LEFT JOIN ${TABLE.AUTH_REFRESH_TOKEN} n ON n.oid = t.replaced_by_oid
               WHERE t.oid = $1`,
        values: [token_oid, auth_config().reuse_grace_seconds],
    });

    if (token.status === "Revoked") {
        await event(AUTH_EVENT.REFRESH_REJECTED, { reason: "revoked" });
        return { result: "ended" };
    }

    if (token.status === "Rotated") {
        if (!(token.in_grace && token.successor_status === "Active")) {
            await event(AUTH_EVENT.REFRESH_TOKEN_REUSE);
            return end("TokenReuse", "reuse");
        }
        await tx.execute_value({
            text: `UPDATE ${TABLE.AUTH_REFRESH_TOKEN} SET status = 'Revoked', edited_by = $2, edited_on = LOCALTIMESTAMP WHERE oid = $1 AND status = 'Active'`,
            values: [token.successor_oid, session.email],
        });
        return rotate(tx, { token_oid, session, event, from_status: "Rotated" });
    }

    if (!token.live) return end("Expired", "expired");
    return rotate(tx, { token_oid, session, event, from_status: "Active" });
};

const rotate = async (tx, { token_oid, session, event, from_status }) => {
    const next = await issue_refresh_token(tx, { session_oid: session.oid, by: session.email });

    // A grace reissue keeps the original rotation time, so repeating it cannot stretch the window.
    const moved = await tx.execute_value({
        text: `UPDATE ${TABLE.AUTH_REFRESH_TOKEN}
               SET status = 'Rotated', replaced_by_oid = $2, rotated_on = COALESCE(rotated_on, LOCALTIMESTAMP), edited_by = $3, edited_on = LOCALTIMESTAMP
               WHERE oid = $1 AND status = $4`,
        values: [token_oid, next.oid, session.email, from_status],
    });
    if (moved.rowCount !== 1) fail(409, "This session was renewed at the same moment elsewhere. Try again.");

    await tx.execute_value({ text: `UPDATE ${TABLE.AUTH_SESSION} SET last_used_on = LOCALTIMESTAMP WHERE oid = $1`, values: [session.oid] });
    await event(AUTH_EVENT.TOKEN_REFRESH, from_status === "Rotated" ? { grace: true } : null);

    return { result: "rotated", login_oid: session.login_oid, session_oid: session.oid, refresh_token: next.raw, remember: session.remember };
};

module.exports = refresh_token;
