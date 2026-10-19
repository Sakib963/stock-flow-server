const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.ADMIN + SUB_CONTEXTS.USER;
const LIST = BASE + ROUTES.GET_USER_LIST;
const DETAILS = BASE + ROUTES.GET_USER_DETAILS;
const ROLES_TO_GIVE = BASE + ROUTES.GET_ASSIGNABLE_ROLES;
const TAKEN = BASE + ROUTES.CHECK_USER_TAKEN;
const CREATE = BASE + ROUTES.CREATE_USER;
const UPDATE = BASE + ROUTES.UPDATE_USER;
const STATUS = BASE + ROUTES.SWITCH_USER_STATUS;
const DELETE = BASE + ROUTES.DELETE_USER;
const SIGN_OUT_EVERYWHERE = BASE + ROUTES.SIGN_OUT_USER_EVERYWHERE;
const SET_FIRST_PASSWORD = CONTEXTS.PROFILE + SUB_CONTEXTS.CHANGE_PASSWORD + ROUTES.SET_FIRST_PASSWORD;
const CATEGORIES = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.CATEGORY + ROUTES.GET_CATEGORY_LIST;

const USERS = ["administration.user.view", "administration.user.create", "administration.user.edit", "administration.user.delete"];
const CATEGORY = ["configuration.category.view"];
const TEMPORARY = "Welcome-2026";

before(h.start);
after(h.stop);

const person = async (permissions, { system = false, owner = false } = {}) => {
    const user = await h.seed_user({ email: `p-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions });
    if (system) await h.query("UPDATE role SET scope = 'system', is_system = true WHERE oid = $1", [user.role_oid]);
    if (owner) await h.query("UPDATE role SET is_system = true WHERE oid = $1", [user.role_oid]);
    await h.query("UPDATE login SET mobile_number = $2 WHERE oid = $1", [user.oid, `019${Math.floor(10000000 + Math.random() * 89999999)}`]);
    return { ...user, token: (await h.sign_in(user)).access };
};
const holder = async (role_oid) => {
    const user = await h.seed_user({ email: `h-${uuidv4().slice(0, 8)}@arithmalabs.test` });
    await h.query("UPDATE login SET role_oid = $1, mobile_number = $3 WHERE oid = $2", [role_oid, user.oid, `018${Math.floor(10000000 + Math.random() * 89999999)}`]);
    return user;
};
const get = (route, token) => h.call(route, { method: "GET", token });
const details = async (oid, token) => (await get(`${DETAILS}/${oid}`, token)).body.data;
const create = (token, body) => h.call(CREATE, { token, body: { name: "Rahim Uddin", email: `r-${uuidv4().slice(0, 8)}@arithmalabs.test`, mobile_number: `017${Math.floor(10000000 + Math.random() * 89999999)}`, password: TEMPORARY, ...body } });
const login = async (oid) => (await h.query("SELECT * FROM login WHERE oid = $1", [oid]))[0];
const edit = async (token, oid, changes) => {
    const d = (await details(oid, token)).details;
    return h.call(UPDATE, { token, body: { oid, version: d.version, name: d.name, mobile_number: d.mobile_number, designation: d.designation, photo: d.photo, role_oid: d.role_oid, ...changes } });
};

describe("users", () => {
    beforeEach(h.reset);

    it("are closed to someone who may not see them", async () => {
        const outsider = await person(CATEGORY);
        assert.equal((await get(LIST, outsider.token)).status, 403);
        assert.equal((await create(outsider.token, { role_oid: outsider.role_oid })).status, 403);
    });

    it("never show the system admin's account to a business, in the list or by its address", async () => {
        const vendor = await person(USERS, { system: true });
        const owner = await person(USERS);
        const emails = (await get(`${LIST}?limit=100`, owner.token)).body.data.rows.map((r) => r.email);
        assert.ok(emails.includes(owner.email));
        assert.ok(!emails.includes(vendor.email));
        assert.equal((await get(`${DETAILS}/${vendor.oid}`, owner.token)).status, 404);
        assert.equal((await h.call(STATUS, { token: owner.token, body: { oid: vendor.oid, status: "Inactive" } })).status, 404);
    });

    it("are created with a role the creator could have made, a temporary password and the change flag, and recorded", async () => {
        const owner = await person([...USERS, ...CATEGORY]);
        const counter = await holder(owner.role_oid);
        const made = await create(owner.token, { role_oid: (await h.query("SELECT role_oid FROM login WHERE oid = $1", [counter.oid]))[0].role_oid, email: "Rahim@Example.com", mobile_number: "01711 000-111" });
        assert.equal(made.status, 200, JSON.stringify(made.body));

        const row = await login(made.body.data.oid);
        assert.deepEqual([row.email, row.mobile_number, row.role_oid, row.must_change_password, row.status], ["rahim@example.com", "01711000111", owner.role_oid, true, "Active"]);
        assert.equal((await details(row.oid, owner.token)).activity[0].action, "Created user");
    });

    it("refuse a role that holds anything the creator does not, and leave it out of the picker", async () => {
        const owner = await person(USERS);
        const richer = await h.seed_user({ email: "richer@arithmalabs.test", permissions: [...USERS, "sales.order.refund"] });

        const refused = await create(owner.token, { role_oid: richer.role_oid });
        assert.equal(refused.status, 403);
        const offered = (await get(ROLES_TO_GIVE, owner.token)).body.data.map((r) => r.oid);
        assert.ok(offered.includes(owner.role_oid));
        assert.ok(!offered.includes(richer.role_oid));
    });

    it("hold the password rule for the temporary password", async () => {
        const owner = await person(USERS);
        assert.equal((await create(owner.token, { role_oid: owner.role_oid, password: "short1" })).status, 400);
        assert.equal((await create(owner.token, { role_oid: owner.role_oid, password: "NoSymbol2026" })).status, 400);
    });

    it("keep an email taken ignoring case, even after its person is deleted, and free a deleted person's phone", async () => {
        const owner = await person(USERS);
        const first = await create(owner.token, { role_oid: owner.role_oid, email: "rafi@example.com", mobile_number: "01800000001" });
        const second = await create(owner.token, { role_oid: owner.role_oid, email: "RAFI@example.com" });
        assert.deepEqual([second.status, second.body.data.field], [409, "email"]);
        const same_phone = await create(owner.token, { role_oid: owner.role_oid, mobile_number: "01800000001" });
        assert.deepEqual([same_phone.status, same_phone.body.data.field], [409, "mobile_number"]);
        assert.deepEqual((await get(`${TAKEN}?email=Rafi@Example.com&mobile_number=01800000001`, owner.token)).body.data, { email: true, mobile_number: true });

        assert.equal((await h.call(DELETE, { token: owner.token, body: { oid: first.body.data.oid } })).status, 200);
        assert.equal((await create(owner.token, { role_oid: owner.role_oid, email: "rafi@example.com" })).status, 409);
        assert.equal((await create(owner.token, { role_oid: owner.role_oid, mobile_number: "01800000001" })).status, 200);
    });

    it("must set their own password before any other request answers", async () => {
        const owner = await person([...USERS, ...CATEGORY]);
        const made = await create(owner.token, { role_oid: owner.role_oid, email: "new@arithmalabs.test" });
        assert.equal(made.status, 200);
        const newcomer = { email: "new@arithmalabs.test", password: TEMPORARY };

        const first = await h.sign_in(newcomer);
        assert.equal(first.res.body.data.user.must_change_password, true);
        const other_device = await h.sign_in(newcomer);
        const blocked = await get(CATEGORIES, first.access);
        assert.deepEqual([blocked.status, blocked.body.data.reason], [403, "must_change_password"]);
        assert.equal((await get(h.ROUTE.ME, first.access)).body.data.user.mustChangePassword, true);

        const wrong = await h.call(SET_FIRST_PASSWORD, { token: first.access, body: { current_password: "Not-it-2026", new_password: "Mine-2026!" } });
        assert.deepEqual([wrong.status, wrong.body.data.field], [400, "current_password"]);
        const same = await h.call(SET_FIRST_PASSWORD, { token: first.access, body: { current_password: TEMPORARY, new_password: TEMPORARY } });
        assert.equal(same.status, 400);

        const set = await h.call(SET_FIRST_PASSWORD, { token: first.access, body: { current_password: TEMPORARY, new_password: "Mine-2026!" } });
        assert.equal(set.status, 200, JSON.stringify(set.body));
        assert.equal((await get(CATEGORIES, first.access)).status, 200);
        assert.equal((await h.session(other_device.session_id)).end_reason, "PasswordChanged");
        assert.equal((await login(made.body.data.oid)).must_change_password, false);
        assert.equal((await h.call(SET_FIRST_PASSWORD, { token: first.access, body: { current_password: "Mine-2026!", new_password: "Again-2026!" } })).status, 400);
    });

    it("stop guessing the temporary password after five tries in fifteen minutes", async () => {
        const owner = await person(USERS);
        await create(owner.token, { role_oid: owner.role_oid, email: "guess@arithmalabs.test" });
        const signed = await h.sign_in({ email: "guess@arithmalabs.test", password: TEMPORARY });
        for (let i = 0; i < 5; i++) assert.equal((await h.call(SET_FIRST_PASSWORD, { token: signed.access, body: { current_password: `Wrong-${i}-2026`, new_password: "Mine-2026!" } })).status, 400);
        assert.equal((await h.call(SET_FIRST_PASSWORD, { token: signed.access, body: { current_password: TEMPORARY, new_password: "Mine-2026!" } })).status, 429);
    });

    it("change role from the next request, refuse a stale save, and record nothing when nothing changed", async () => {
        const owner = await person([...USERS, ...CATEGORY]);
        const staff_role = (await h.seed_user({ email: "x@arithmalabs.test", permissions: CATEGORY })).role_oid;
        const staff = await holder(owner.role_oid);
        const signed = await h.sign_in(staff);
        assert.equal((await get(LIST, signed.access)).status, 200);

        const before = (await details(staff.oid, owner.token)).details;
        const version = async () => Number((await h.query("SELECT version FROM config_version"))[0].version);
        const config_before = await version();
        const changed = await edit(owner.token, staff.oid, { role_oid: staff_role });
        assert.equal(changed.status, 200, JSON.stringify(changed.body));
        assert.equal(await version(), config_before + 1, "a role change raises the config version");
        assert.equal((await get(LIST, signed.access)).status, 403, "the new role applies on the next request");
        assert.equal((await details(staff.oid, owner.token)).activity[0].action, "Changed role");

        const stale = await h.call(UPDATE, { token: owner.token, body: { oid: staff.oid, version: before.version, name: "Late", mobile_number: "01900000000", designation: null, photo: null, role_oid: staff_role } });
        assert.equal(stale.status, 409);

        const count = (await h.query("SELECT COUNT(*)::int AS n FROM activity_log WHERE reference_oid = $1", [staff.oid]))[0].n;
        const nothing = await edit(owner.token, staff.oid, {});
        assert.deepEqual([nothing.status, nothing.body.data.changed], [200, false]);
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM activity_log WHERE reference_oid = $1", [staff.oid]))[0].n, count);
    });

    it("never let anyone turn off, delete or change the role of their own account", async () => {
        const owner = await person(USERS);
        const other = (await h.seed_user({ email: "y@arithmalabs.test", permissions: ["administration.user.view"] })).role_oid;
        assert.equal((await h.call(STATUS, { token: owner.token, body: { oid: owner.oid, status: "Inactive" } })).status, 400);
        assert.equal((await h.call(DELETE, { token: owner.token, body: { oid: owner.oid } })).status, 400);
        assert.equal((await edit(owner.token, owner.oid, { role_oid: other })).status, 400);
        assert.equal((await details(owner.oid, owner.token)).details.self, true);
    });

    it("keep the last active owner", async () => {
        const vendor = await person(USERS, { system: true });
        const owner = await person(USERS, { owner: true });
        assert.equal((await details(owner.oid, vendor.token)).details.last_owner, true);
        assert.equal((await h.call(STATUS, { token: vendor.token, body: { oid: owner.oid, status: "Inactive" } })).status, 400);
        assert.equal((await h.call(DELETE, { token: vendor.token, body: { oid: owner.oid } })).status, 400);

        await holder(owner.role_oid);
        assert.equal((await h.call(STATUS, { token: vendor.token, body: { oid: owner.oid, status: "Inactive" } })).status, 200);
    });

    it("refuse changes to someone whose role holds more than the caller", async () => {
        const owner = await h.seed_user({ email: "boss@arithmalabs.test", permissions: [...USERS, "sales.order.refund"] });
        const manager = await person(["administration.user.view", "administration.user.edit"]);
        assert.equal((await h.call(STATUS, { token: manager.token, body: { oid: owner.oid, status: "Inactive" } })).status, 403);
        assert.equal((await details(owner.oid, manager.token)).details.within_reach, false);
    });

    it("turned off lose every session and cannot sign in until turned on", async () => {
        const owner = await person(USERS);
        const staff = await holder(owner.role_oid);
        const device = await h.sign_in(staff);
        assert.equal((await h.call(STATUS, { token: owner.token, body: { oid: staff.oid, status: "Inactive" } })).status, 200);
        assert.equal((await h.session(device.session_id)).end_reason, "UserDeactivated");
        assert.equal((await h.call(h.ROUTE.SIGN_IN, { body: { email: staff.email, password: staff.password } })).status, 403);
        assert.equal((await h.call(STATUS, { token: owner.token, body: { oid: staff.oid, status: "Active" } })).status, 200);
        await h.sign_in(staff);
    });

    it("deleted are kept, signed out, refused at sign-in, and shown only when asked for", async () => {
        const owner = await person(USERS);
        const staff = await holder(owner.role_oid);
        const device = await h.sign_in(staff);
        assert.equal((await h.call(DELETE, { token: owner.token, body: { oid: staff.oid } })).status, 200);

        assert.equal((await login(staff.oid)).status, "Deleted");
        assert.equal((await h.session(device.session_id)).status, "Revoked");
        const refused = await h.call(h.ROUTE.SIGN_IN, { body: { email: staff.email, password: staff.password } });
        assert.deepEqual([refused.status, /closed/.test(refused.body.message)], [403, true]);
        assert.ok(!(await get(`${LIST}?limit=100`, owner.token)).body.data.rows.some((r) => r.oid === staff.oid));
        assert.ok((await get(`${LIST}?limit=100&status=Deleted`, owner.token)).body.data.rows.some((r) => r.oid === staff.oid));
        assert.equal((await h.call(STATUS, { token: owner.token, body: { oid: staff.oid, status: "Active" } })).status, 404, "deleting is final");
    });

    it("sign out everywhere ends every device and shows them on the record first", async () => {
        const owner = await person(USERS);
        const staff = await holder(owner.role_oid);
        const phone = await h.sign_in(staff);
        await h.sign_in(staff);
        const record = await details(staff.oid, owner.token);
        assert.equal(record.sessions.length, 2);
        assert.ok(record.details.last_sign_in_on);

        const res = await h.call(SIGN_OUT_EVERYWHERE, { token: owner.token, body: { oid: staff.oid } });
        assert.deepEqual([res.status, res.body.data.devices], [200, 2]);
        assert.equal((await h.session(phone.session_id)).end_reason, "RemoteSignOut");
        assert.equal((await details(staff.oid, owner.token)).sessions.length, 0);
    });

    it("show the role's access on the record, read through the role", async () => {
        const owner = await person([...USERS, ...CATEGORY]);
        const record = await details(owner.oid, owner.token);
        assert.deepEqual(record.access.actions.map((a) => a.code).sort(), [...USERS, ...CATEGORY].sort());
    });
});
