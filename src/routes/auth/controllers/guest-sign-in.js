const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../db/database");
const { log } = require("../../../utils/log");
const { saveLogActivity } = require("../../../utils/activity-logger");
const { check_rate_limit } = require("../../../middleware/rate-limit");
const { open_session, grant_tokens, request_context } = require("../../../auth/auth-session");
const { AUTH_EVENT, record_auth_event_in } = require("../../../auth/auth-event");
const { GUEST_NAMES } = require("../utils/guest-names");

// Read on every request, so a deployment turns guests on or off by its settings alone. Off unless
// GUEST_ACCESS is exactly "on": a client's deployment never sets it.
const guest_settings = () => ({
    on: process.env.GUEST_ACCESS === "on",
    role: process.env.GUEST_ROLE || "",
    hours: Number(process.env.GUEST_HOURS) || 24,
    per_machine: Number(process.env.GUEST_LIMIT_PER_MACHINE) || 3,
    cap: Number(process.env.GUEST_ACTIVE_CAP) || 100,
});

/**
 * A visitor to the dev deployment becomes a guest with one press: a temporary account with a random
 * approved name, signed straight in. What a guest may do is only the grants of the role GUEST_ROLE
 * names, so nothing here decides it (docs/guest-access).
 */
const guest_sign_in = async (request, res) => {
    const settings = guest_settings();
    if (!settings.on) return res.status(404).json({ code: 404, message: "Not found." });
    const context = request_context(request);

    try {
        const verdict = await check_rate_limit({ bucket: "guest-sign-in-ip", identifier: context.ip_address, limit: settings.per_machine, window_minutes: 60 });
        if (!verdict.allowed) {
            res.set("Retry-After", String(verdict.retry_after_seconds));
            return res.status(429).json({ code: 429, message: "Too many guest visits from this device. Try again in an hour." });
        }

        const guest = await execute_transaction(async (tx) => {
            await tx.execute_value({
                text: `UPDATE ${TABLE.LOGIN} SET status = 'Inactive', edited_by = 'System', edited_on = clock_timestamp() WHERE is_guest AND status = 'Active' AND expires_on <= LOCALTIMESTAMP`,
                values: [],
            });
            // Taken while the count is read, so two visitors at the cap cannot both get in.
            await tx.execute_value({ text: "SELECT pg_advisory_xact_lock(hashtext('guest-sign-in'))", values: [] });
            const [{ active }] = await tx.get_data({ text: `SELECT count(*)::int AS active FROM ${TABLE.LOGIN} WHERE is_guest AND status = 'Active'`, values: [] });
            if (active >= settings.cap) fail(503, "Guest visits are full right now. Try again later.");

            const [role] = await tx.get_data({ text: `SELECT oid, name FROM ${TABLE.ROLE} WHERE lower(trim(name)) = lower(trim($1)) AND status = 'Active' AND scope = 'business'`, values: [settings.role] });
            if (!role) {
                log.error(`Guest sign-in is on but the role "${settings.role}" is missing, inactive or not a business role`);
                fail(503, "Guest visits are not available right now. Try again later.");
            }

            const name = await free_name(tx, GUEST_NAMES[crypto.randomInt(GUEST_NAMES.length)]);
            const oid = uuidv4();
            const email = `guest-${oid.slice(0, 8)}@guest.invalid`;
            const seconds = settings.hours * 3600;
            await tx.execute_value({
                text: `INSERT INTO ${TABLE.LOGIN} (oid, email, password, name, role_oid, status, must_change_password, is_guest, expires_on, created_by)
                       VALUES ($1, $2, $3, $4, $5, 'Active', false, true, LOCALTIMESTAMP + make_interval(secs => $6), 'Guest access')`,
                values: [oid, email, await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 10), name, role.oid, seconds],
            });
            await saveLogActivity({ reference_type: "user", reference_oid: oid, title: "Guest visit started", description: `${name} tried StockFlow as a guest.` }, { tx, request: { credentials: { user_id: email }, request_id: request.request_id } });
            const session = await open_session(tx, { login_oid: oid, email, remember: false, context, max_seconds: seconds });
            await record_auth_event_in(tx, { event_type: AUTH_EVENT.LOGIN_SUCCESS, login_oid: oid, session_oid: session.session_oid, email, context });
            return { oid, email, name, role_name: role.name, hours: settings.hours, session };
        });

        log.info(`Guest visit started: ${guest.email}`);
        return res.status(200).json({
            code: 200,
            message: "Signed in as a guest",
            data: {
                ...grant_tokens(res, { login_oid: guest.oid, session_oid: guest.session.session_oid, refresh_token: guest.session.refresh_token, remember: false }),
                user: { id: guest.oid, email: guest.email, name: guest.name, role: guest.role_name, must_change_password: false },
                guest: { hours: guest.hours },
            },
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while starting a guest visit: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something went wrong. Please try again later." });
    }
};

// Two active guests are told apart in activity, so a name in use gets the next free number.
const free_name = async (tx, base) => {
    const rows = await tx.get_data({ text: `SELECT name FROM ${TABLE.LOGIN} WHERE is_guest AND status = 'Active' AND (name = $1 OR name LIKE $1 || ' %')`, values: [base] });
    const taken = new Set(rows.map((r) => r.name));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
};

module.exports = guest_sign_in;
