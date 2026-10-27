// What every test file shares: the real Express app on a free port, the real database utilities
// pointed at the local test database, and the few helpers the auth tests lean on.
const path = require("path");
process.env.ENV_FILE = path.join(__dirname, "../.env.test");

// Tests never send email. Replaced before anything requires it, so every controller gets this copy.
const send_email_path = require.resolve("../../src/email/send-email");
require.cache[send_email_path] = { id: send_email_path, filename: send_email_path, loaded: true, exports: async () => ({ messageId: "test" }) };

const assert = require("node:assert/strict");
const crypto = require("crypto");
const { once } = require("events");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const app = require("../../server");
const pool = require("../../src/db/db.config");
const { columns_version } = require("../../src/db/stale-edit");
const { SETTINGS_FORM } = require("../../src/utils/settings-cache");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const PASSWORD = "Counter-sale-2026";

const ROUTE = {
    SIGN_IN: CONTEXTS.AUTH + ROUTES.SIGN_IN,
    REFRESH: CONTEXTS.AUTH + ROUTES.REFRESH_TOKEN,
    SIGN_OUT: CONTEXTS.AUTH + ROUTES.SIGN_OUT,
    SIGN_OUT_EVERYWHERE: CONTEXTS.AUTH + ROUTES.SIGN_OUT_EVERYWHERE,
    SESSIONS: CONTEXTS.AUTH + ROUTES.GET_SESSIONS,
    SIGN_OUT_SESSION: CONTEXTS.AUTH + ROUTES.SIGN_OUT_SESSION,
    ME: CONTEXTS.AUTH + ROUTES.GET_USER_INFO,
    RESET_PASSWORD: CONTEXTS.AUTH + ROUTES.RESET_PASSWORD,
    VERIFY_PASSWORD_CHANGE: CONTEXTS.PROFILE + SUB_CONTEXTS.CHANGE_PASSWORD + ROUTES.VERIFY_OTP_FOR_PASSWORD_CHANGE,
    SWITCH_USER_STATUS: CONTEXTS.ADMIN + SUB_CONTEXTS.USER + ROUTES.SWITCH_USER_STATUS,
};

// The table behind each edit that refuses a stale form. A test that sends no version edits the way a
// freshly opened form does, with the row's version as it is now; a test sends an old one on purpose.
const STALE_GUARDED = Object.entries(require("./stale-guarded")).map(([key, table]) => [ROUTES[key], table]);

const guarded_table = (route) => STALE_GUARDED.find(([suffix]) => route.endsWith(suffix))?.[1];

let server;
let base;

const start = async () => {
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
};

const stop = async () => {
    await new Promise((resolve) => server.close(resolve));
    // Activity logging is fired and forgotten; give it a moment before the pool goes away under it.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await pool.end();
};

const query = async (text, values = []) => (await pool.query(text, values)).rows;

const reset = () => query("TRUNCATE auth_event, auth_refresh_token, auth_session, request_throttle, activity_log, otp_log, role_permission, permission, login, role, categories, brands, supplier, warehouse, partner, campaign CASCADE");

const seed_user = async ({ email = "owner@arithmalabs.test", status = "Active", permissions = [] } = {}) => {
    const role_oid = uuidv4();
    const role_name = `Role ${role_oid.slice(0, 8)}`;
    await query("INSERT INTO role (oid, name, status) VALUES ($1, $2, 'Active')", [role_oid, role_name]);

    for (const code of permissions) {
        const [module, feature, action] = code.split(".");
        await query("INSERT INTO permission (oid, code, module, feature, action, label) VALUES ($1, $2, $3, $4, $5, $2) ON CONFLICT (code) DO NOTHING", [uuidv4(), code, module, feature, action]);
        await query("INSERT INTO role_permission (oid, role_oid, permission_oid) SELECT $1, $2, oid FROM permission WHERE code = $3", [uuidv4(), role_oid, code]);
    }

    const oid = uuidv4();
    await query("INSERT INTO login (oid, email, password, name, role, status, role_oid) VALUES ($1, $2, $3, $4, $5, $6, $7)", [oid, email, await bcrypt.hash(PASSWORD, 4), "Samiha Rahman", "Owner", status, role_oid]);
    return { oid, email, password: PASSWORD, role_oid, role_name };
};

const json_or_text = (text) => {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

// The settings row has one version per form, over that form's own columns.
const settings_version = (form) => query(`SELECT ${columns_version(SETTINGS_FORM[form])} AS version FROM settings ORDER BY created_on LIMIT 1`).then((rows) => rows[0]?.version ?? "0");
const current_version = (table, oid) => (table.startsWith("settings.") ? settings_version(table.split(".")[1]) : version_of(table, oid));

// Every edit a test makes is first sent once more from an old form, version "1", which no live row
// carries. It must be refused as changed since loaded and leave the row as it was, so each guarded
// edit is proven by every test that already exercises it. A refusal for another reason (no
// permission, a body the schema rejects, a record that is not there) says nothing either way.
const call = async (route, options = {}) => {
    const { method = "POST", body } = options;
    const table = method === "POST" && body && !("version" in body) && guarded_table(route);
    if (!table) return send(route, options);
    const before = await current_version(table, body.oid);
    const stale = await send(route, { ...options, body: { ...body, version: "1" } });
    if (![400, 401, 403, 404].includes(stale.status)) {
        assert.equal(stale.status, 409, `${route} took an edit from a form opened before someone else saved: ${JSON.stringify(stale.body)}`);
        assert.equal(stale.body?.data?.reason, "changed_since_loaded", `${route} refused a stale edit for another reason: ${JSON.stringify(stale.body)}`);
        assert.equal(await current_version(table, body.oid), before, `${route} wrote to the row while refusing a stale edit`);
    }
    return send(route, { ...options, body: { ...body, version: before } });
};

const send = async (route, { method = "POST", body, token, cookie, headers: extra = {} } = {}) => {
    const headers = { ...extra };
    if (method !== "GET") headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    if (cookie) headers.cookie = `sf_rt=${cookie}`;

    const res = await fetch(base + route, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
    const text = await res.text();
    const refresh_cookie = res.headers.getSetCookie().find((c) => c.startsWith("sf_rt=")) ?? null;

    return {
        status: res.status,
        body: text ? json_or_text(text) : null,
        request_id: res.headers.get("x-request-id"),
        config_version: res.headers.get("x-config-version"),
        reference_version: res.headers.get("x-reference-version"),
        etag: res.headers.get("etag"),
        set_cookie: refresh_cookie,
        cookie: refresh_cookie === null ? null : decodeURIComponent(refresh_cookie.slice("sf_rt=".length, refresh_cookie.indexOf(";"))),
    };
};

const body_transport = () => process.env.AUTH_REFRESH_TRANSPORT === "body";

/** The refresh token a response handed over, whichever way it travelled. */
const refresh_token_of = (res) => (body_transport() ? res.body?.data?.refresh_token : res.cookie) ?? null;

const sign_in = async (user, { remember = false, user_agent } = {}) => {
    const res = await call(ROUTE.SIGN_IN, { body: { email: user.email, password: user.password, remember }, headers: user_agent ? { "user-agent": user_agent } : {} });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return { access: res.body.data.access_token, refresh: refresh_token_of(res), session_id: res.body.data.session_id, res };
};

const refresh = (token) => (body_transport() ? call(ROUTE.REFRESH, { body: { refresh_token: token } }) : call(ROUTE.REFRESH, { cookie: token }));

const hash = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

const sign_token = (claims, options = {}) => jwt.sign(claims, process.env.ACCESS_TOKEN_SECRET, { algorithm: "HS256", ...options });

const session = async (oid) => (await query("SELECT * FROM auth_session WHERE oid = $1", [oid]))[0];
const token_row = async (raw) => (await query("SELECT * FROM auth_refresh_token WHERE token_hash = $1", [hash(raw)]))[0];
const events = (type) => query("SELECT * FROM auth_event WHERE event_type = $1 ORDER BY created_on", [type]);

/** For writes that are deliberately fired and forgotten, such as the activity log. */
const eventually = async (read, accept, { tries = 20, every = 50 } = {}) => {
    let value;
    for (let i = 0; i < tries; i++) {
        value = await read();
        if (accept(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, every));
    }
    return value;
};

/** The running server, for a test that reads a response as bytes rather than JSON. */
const url = () => base;

// The row version a form would have loaded, for an edit to send back.
const version_of = async (table, oid) => (await query(`SELECT xmin::text AS version FROM ${table} WHERE oid = $1`, [oid]))[0]?.version ?? "0";

module.exports = { version_of, url, ROUTE, PASSWORD, start, stop, query, reset, seed_user, call, sign_in, refresh, refresh_token_of, hash, sign_token, session, token_row, events, eventually };
