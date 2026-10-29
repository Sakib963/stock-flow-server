const { describe, it, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");
const { GUEST_NAMES } = require("../../src/routes/auth/utils/guest-names");

const GUEST = CONTEXTS.AUTH + ROUTES.GUEST_SIGN_IN;
const CATEGORIES = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.CATEGORY + ROUTES.GET_CATEGORY_LIST;
const USERS = CONTEXTS.ADMIN + SUB_CONTEXTS.USER + ROUTES.GET_USER_LIST;

before(h.start);
after(h.stop);

// Each test visits from its own address, so one test's three per machine never counts against another's.
const machine = () => ({ "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
const visit = (headers = machine()) => h.call(GUEST, { body: {}, headers });
const guests = () => h.query("SELECT name, email, status, is_guest, role_oid, EXTRACT(EPOCH FROM expires_on - LOCALTIMESTAMP)::int AS left FROM login WHERE is_guest ORDER BY created_on");

describe("trying StockFlow as a guest", () => {
    let role;

    beforeEach(async () => {
        await h.reset();
        // The Guest role is an ordinary role: here it may look at categories and nothing else.
        role = await h.seed_user({ email: "owner@arithmalabs.test", permissions: ["configuration.category.view"] });
        Object.assign(process.env, { GUEST_ACCESS: "on", GUEST_ROLE: role.role_name, GUEST_HOURS: "24", GUEST_LIMIT_PER_MACHINE: "3", GUEST_ACTIVE_CAP: "100" });
    });

    afterEach(() => {
        for (const key of ["GUEST_ACCESS", "GUEST_ROLE", "GUEST_HOURS", "GUEST_LIMIT_PER_MACHINE", "GUEST_ACTIVE_CAP"]) delete process.env[key];
    });

    it("is not there at all unless the deployment turns it on", async () => {
        delete process.env.GUEST_ACCESS;
        assert.equal((await visit()).status, 404);
        assert.deepEqual(await guests(), []);
    });

    it("makes a 24 hour guest with an approved name and the Guest role, and signs it in", async () => {
        const res = await visit();

        assert.equal(res.status, 200, JSON.stringify(res.body));
        const { user, access_token, guest } = res.body.data;
        assert.ok(GUEST_NAMES.includes(user.name));
        assert.equal(guest.hours, 24);
        const [row] = await guests();
        assert.deepEqual([row.name, row.status, row.is_guest, row.role_oid], [user.name, "Active", true, role.role_oid]);
        assert.match(row.email, /@guest\.invalid$/);
        assert.ok(row.left > 23 * 3600 && row.left <= 24 * 3600);

        const me = await h.call(h.ROUTE.ME, { method: "GET", token: access_token });
        assert.equal(me.status, 200);
        assert.equal(me.body.data.user.name, user.name);
    });

    it("lets a guest do exactly what the Guest role is granted", async () => {
        const { access_token } = (await visit()).body.data;

        assert.equal((await h.call(CATEGORIES, { method: "GET", token: access_token })).status, 200);
        assert.equal((await h.call(USERS, { method: "GET", token: access_token })).status, 403);
    });

    it("refuses every change a guest sends, even one the Guest role grants, and writes nothing", async () => {
        await h.query("INSERT INTO role_permission (role_oid, permission_oid) SELECT $1, oid FROM permission WHERE code = 'configuration.category.create'", [role.role_oid]);
        const { access_token } = (await visit()).body.data;

        const category = await h.call(CONTEXTS.CONFIGURATION + SUB_CONTEXTS.CATEGORY + ROUTES.CREATE_CATEGORY, { method: "POST", token: access_token, body: { name: "Saree", category_code: "SARE", status: "Active" } });
        const note = await h.call(CONTEXTS.PROFILE + SUB_CONTEXTS.NOTES + ROUTES.CREATE_USER_NOTE, { method: "POST", token: access_token, body: { oid: uuidv4(), note_title: "Mine" } });

        assert.deepEqual([category.status, category.body.data.reason], [403, "guest"]);
        assert.deepEqual([note.status, note.body.data.reason], [403, "guest"]);
        assert.equal((await h.query("SELECT count(*)::int AS n FROM categories")).at(0).n, 0);
        assert.equal((await h.query("SELECT count(*)::int AS n FROM user_notes")).at(0).n, 0);
    });

    it("still lets a guest read and sign out of its own sessions", async () => {
        const { access_token } = (await visit()).body.data;

        assert.equal((await h.call(CATEGORIES, { method: "GET", token: access_token })).status, 200);
        assert.equal((await h.call(h.ROUTE.SIGN_OUT_EVERYWHERE, { method: "POST", token: access_token, body: {} })).status, 200);
    });

    it("stops a fourth guest from one machine within the hour, saying how long to wait", async () => {
        const headers = machine();
        for (let i = 0; i < 3; i++) assert.equal((await visit(headers)).status, 200);

        const fourth = await visit(headers);

        assert.equal(fourth.status, 429);
        assert.ok(Number(fourth.retry_after) > 0);
        assert.equal((await guests()).length, 3);
    });

    it("turns visitors away once the cap of active guests is reached", async () => {
        process.env.GUEST_ACTIVE_CAP = "1";
        assert.equal((await visit()).status, 200);

        const second = await visit();

        assert.equal(second.status, 503);
        assert.match(second.body.message, /full/);
    });

    it("refuses and makes nothing when the Guest role is missing or turned off", async () => {
        process.env.GUEST_ROLE = "No such role";
        assert.equal((await visit()).status, 503);

        process.env.GUEST_ROLE = role.role_name;
        await h.query("UPDATE role SET status = 'Inactive' WHERE oid = $1", [role.role_oid]);
        assert.equal((await visit()).status, 503);

        assert.deepEqual(await guests(), []);
    });

    it("never makes a guest of a system-scope role, whose grants no business person may hold", async () => {
        await h.query("UPDATE role SET scope = 'system' WHERE oid = $1", [role.role_oid]);

        assert.equal((await visit()).status, 503);
        assert.deepEqual(await guests(), []);
    });

    it("numbers a name an active guest already has, so two guests are told apart", async () => {
        for (const name of GUEST_NAMES) {
            await h.query("INSERT INTO login (oid, email, password, name, status, role_oid, is_guest, expires_on) VALUES ($1, $2, 'x', $3, 'Active', $4, true, LOCALTIMESTAMP + interval '1 hour')", [uuidv4(), `taken-${uuidv4().slice(0, 8)}@guest.invalid`, name, role.role_oid]);
        }

        const { user } = (await visit()).body.data;

        assert.match(user.name, / 2$/);
        assert.ok(GUEST_NAMES.includes(user.name.replace(/ 2$/, "")));
    });

    it("ends a guest's visit after its time: the session is refused, and the account is kept as Inactive", async () => {
        const first = (await visit()).body.data;
        await h.query("UPDATE login SET expires_on = LOCALTIMESTAMP - interval '1 minute' WHERE is_guest");
        await h.query("UPDATE auth_session SET expires_on = LOCALTIMESTAMP - interval '1 minute'");

        assert.equal((await h.call(h.ROUTE.ME, { method: "GET", token: first.access_token })).status, 401);

        await visit();
        const rows = await guests();
        assert.deepEqual(rows.map((r) => r.status), ["Inactive", "Active"], "the next visit marks the expired guest Inactive and keeps it");
    });
});
