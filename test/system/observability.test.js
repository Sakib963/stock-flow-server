const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.SYSTEM + SUB_CONTEXTS.OBSERVABILITY;
const VIEW = "system.observability.view";

before(h.start);
after(h.stop);

let today;
let admin;

// A request as the log keeps it, `hour` on the business clock today.
const logged = (fields = {}, hour = 12) =>
    h.query(
        `INSERT INTO api_request_log (oid, occurred_on, method, route, path, status, duration_ms, login_oid, ip, request_body)
         VALUES ($1, ((date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka') + make_interval(hours => $2)) AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'UTC', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [fields.oid ?? uuidv4(), hour, fields.method ?? "GET", fields.route ?? "/api/v1/test/thing/:oid", fields.path ?? `/api/v1/test/thing/${uuidv4()}`, fields.status ?? 200, fields.duration_ms ?? 10, fields.login_oid ?? null, fields.ip ?? "198.51.100.1", fields.request_body ?? null]
    );

const get = async (route, query = {}) => (await h.call(`${BASE}${route}?${new URLSearchParams({ date_from: today, date_to: today, ...query })}`, { method: "GET", token: admin.token })).body;

describe("observability", () => {
    beforeEach(async () => {
        await h.reset();
        await h.query("TRUNCATE api_request_log");
        await h.query("UPDATE menu_item SET is_disabled = false WHERE slug = 'system-observability'");
        await h.query("UPDATE config_version SET version = version + 1");
        today = (await h.query("SELECT to_char((now() AT TIME ZONE 'Asia/Dhaka')::date, 'YYYY-MM-DD') AS day"))[0].day;
        const user = await h.seed_user({ email: "vendor@arithmalabs.test", permissions: [VIEW] });
        admin = { ...user, token: (await h.sign_in(user)).access };
    });

    it("is closed without a sign-in, and to anyone without the system permission", async () => {
        assert.equal((await h.call(`${BASE}${ROUTES.GET_REQUEST_LIST}?date_from=${today}&date_to=${today}`, { method: "GET" })).status, 401);
        const owner = await h.seed_user({ email: "owner2@arithmalabs.test", permissions: ["activity-log.activity-log.view"] });
        const token = (await h.sign_in(owner)).access;
        assert.equal((await h.call(`${BASE}${ROUTES.GET_REQUEST_LIST}?date_from=${today}&date_to=${today}`, { method: "GET", token })).status, 403);
    });

    it("refuses a range longer than 31 days, so no query reads the whole log", async () => {
        const res = await h.call(`${BASE}${ROUTES.GET_REQUEST_LIST}?date_from=2026-01-01&date_to=2026-03-01`, { method: "GET", token: admin.token });
        assert.equal(res.status, 400);
    });

    it("lists one person's failed requests newest first, a page at a time, with the total", async () => {
        const person = await h.seed_user({ email: "cashier@arithmalabs.test" });
        await logged({ login_oid: person.oid, status: 500 }, 9);
        await logged({ login_oid: person.oid, status: 502 }, 10);
        await logged({ login_oid: person.oid, status: 200 }, 11);
        await logged({ login_oid: uuidv4(), status: 500 }, 11);
        const page = await get(ROUTES.GET_REQUEST_LIST, { person: person.email, status: "5xx", limit: 1 });
        assert.equal(page.total, 2);
        assert.equal(page.data.rows.length, 1);
        assert.equal(page.data.rows[0].status, 502);
        assert.equal(page.data.rows[0].request_body, undefined, "a list never carries bodies");
    });

    it("opens a request with its body and the business action it caused", async () => {
        const oid = uuidv4();
        await logged({ oid, method: "POST", request_body: { name: "Lipstick", password: "[redacted]" } });
        await h.query("INSERT INTO activity_log (oid, reference_oid, reference_type, title, performed_by, request_id) VALUES ($1, $1, 'brand', 'Created brand', 'x@arithmalabs.test', $2)", [uuidv4(), oid]);
        const res = await h.call(`${BASE}${ROUTES.GET_REQUEST_DETAILS}/${oid}`, { method: "GET", token: admin.token });
        assert.equal(res.body.data.request_body.name, "Lipstick");
        assert.equal(res.body.data.activity[0].title, "Created brand");
        assert.equal((await h.call(`${BASE}${ROUTES.GET_REQUEST_DETAILS}/${uuidv4()}`, { method: "GET", token: admin.token })).status, 404);
    });

    it("measures a route once however many records it was called for, with its slow tail and error rate", async () => {
        for (let i = 1; i <= 20; i++) await logged({ duration_ms: i * 10, status: i === 20 ? 500 : 200 });
        const row = (await get(ROUTES.GET_ROUTE_METRICS)).data.rows.find((r) => r.route === "/api/v1/test/thing/:oid");
        assert.deepEqual([row.calls, row.p95_ms, row.slowest_ms, row.error_rate], [20, 190, 200, 0.05]);
    });

    it("flags a burst of refusals from one address, and night work, but not the vendor reading this screen", async () => {
        for (let i = 0; i < 21; i++) await logged({ ip: "203.0.113.9", status: 404 });
        const night = uuidv4();
        await logged({ login_oid: night }, 2);
        await logged({ login_oid: admin.oid, route: `${BASE}${ROUTES.GET_REQUEST_LIST}` }, 2);
        const signals = Object.fromEntries((await get(ROUTES.GET_SIGNALS)).data.signals.map((s) => [s.key, s.matches]));
        assert.equal(signals.refusal_burst[0].ip, "203.0.113.9");
        assert.ok(signals.off_hours.some((m) => m.oid === night));
        assert.ok(!signals.off_hours.some((m) => m.oid === admin.oid));
        assert.equal(signals.list_sweeping.length, 0);
    });

    it("records a page that broke on someone's screen, and shows it to the system admin with the page and the error", async () => {
        const cashier = await h.seed_user({ email: "cashier@arithmalabs.test" });
        const token = (await h.sign_in(cashier)).access;
        const report = CONTEXTS.PROFILE + SUB_CONTEXTS.CRASH_REPORT + ROUTES.REPORT_CRASH;
        assert.equal((await h.call(report, { token, body: { page: "/app/sales/pos", message: "Cannot read properties of undefined (reading 'oid')", stack: "at PosComponent.add" } })).status, 200);
        assert.equal((await h.call(report, { token, body: { page: "/app/sales/pos" } })).status, 400, "a report says what broke");
        assert.equal((await h.call(report, { body: { page: "/app/sales/pos", message: "x" } })).status, 401, "only someone signed in can report");

        const crashes = (await get(ROUTES.GET_CRASH_LIST)).data.rows;
        assert.equal(crashes.length, 1);
        assert.deepEqual([crashes[0].page, crashes[0].email], ["/app/sales/pos", "cashier@arithmalabs.test"]);
        assert.match(crashes[0].message, /reading 'oid'/);
    });

    it("reports the database size against the plan and the connections in use", async () => {
        const res = await h.call(`${BASE}${ROUTES.GET_DATABASE_STATUS}`, { method: "GET", token: admin.token });
        const db = res.body.data;
        assert.ok(db.database_bytes > 0 && db.plan_bytes > db.database_bytes);
        assert.ok(db.connections >= 1 && db.max_connections >= db.connections);
        assert.ok(db.tables.some((t) => t.name === "api_request_log"));
    });
    it("counts who used the app and how much, busiest first, by the business's day", async () => {
        const rina = await h.seed_user({ email: "rina@arithmalabs.test" });
        const mita = await h.seed_user({ email: "mita@arithmalabs.test" });
        for (let i = 0; i < 3; i++) await logged({ login_oid: rina.oid });
        await logged({ login_oid: mita.oid });

        const usage = (await get(ROUTES.GET_OBSERVABILITY_USAGE)).data;

        const seen = usage.people.filter((p) => [rina.oid, mita.oid].includes(p.oid));
        assert.deepEqual(seen.map((p) => [p.email, p.requests]), [["rina@arithmalabs.test", 3], ["mita@arithmalabs.test", 1]]);
        assert.ok(usage.people_count >= 2);
        const day = usage.daily.find((d) => d.day === today);
        assert.ok(day.requests >= 4 && day.people >= 2);
        assert.ok(usage.last_active);
    });

    it("keeps usage to the system admin", async () => {
        const token = (await h.sign_in(await h.seed_user({ email: "owner@arithmalabs.test", permissions: ["dashboard.overview.view"] }))).access;
        assert.equal((await h.call(`${BASE}${ROUTES.GET_OBSERVABILITY_USAGE}?date_from=${today}&date_to=${today}`, { method: "GET", token })).status, 403);
    });
});
