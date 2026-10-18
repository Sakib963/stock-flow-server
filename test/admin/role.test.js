const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.ADMIN + SUB_CONTEXTS.ROLE;
const LIST = BASE + ROUTES.GET_ROLE_LIST;
const TREE = BASE + ROUTES.GET_ROLE_TREE;
const DETAILS = BASE + ROUTES.GET_ROLE_DETAILS;
const CREATE = BASE + ROUTES.CREATE_ROLE;
const UPDATE = BASE + ROUTES.UPDATE_ROLE;
const STATUS = BASE + ROUTES.SWITCH_ROLE_STATUS;
const DELETE = BASE + ROUTES.DELETE_ROLE;
const SENSITIVE = CONTEXTS.ADMIN + SUB_CONTEXTS.FEATURE + ROUTES.MARK_ACTION_SENSITIVE;
const CATEGORIES = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.CATEGORY + ROUTES.GET_CATEGORY_LIST;

const ROLES = ["administration.role.view", "administration.role.create", "administration.role.edit", "administration.role.delete"];
const CATEGORY = ["configuration.category.view", "configuration.category.create"];
const SYSTEM_KEPT = ["system.feature.view", "system.feature.edit"];

before(h.start);
after(h.stop);

const person = async (permissions, { system = false } = {}) => {
    const user = await h.seed_user({ email: `p-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions });
    if (system) await h.query("UPDATE role SET scope = 'system', is_system = true WHERE oid = $1", [user.role_oid]);
    return { ...user, token: (await h.sign_in(user)).access };
};
const get = (route, token) => h.call(route, { method: "GET", token });
const details = async (oid, token) => (await get(`${DETAILS}/${oid}`, token)).body.data;
const create = (token, body) => h.call(CREATE, { token, body: { name: `Counter ${uuidv4().slice(0, 6)}`, ...body } });

describe("roles", () => {
    beforeEach(h.reset);

    it("are closed to someone who may not see them", async () => {
        const outsider = await person(CATEGORY);
        assert.equal((await get(LIST, outsider.token)).status, 403);
        assert.equal((await get(TREE, outsider.token)).status, 403);
        assert.equal((await create(outsider.token, { codes: CATEGORY })).status, 403);
    });

    it("never show the system admin's role to a business, in the list or by its address", async () => {
        const vendor = await person([...ROLES, ...SYSTEM_KEPT], { system: true });
        const owner = await person(ROLES);
        const names = (await get(`${LIST}?limit=100`, owner.token)).body.data.rows.map((r) => r.name);
        assert.ok(names.includes(owner.role_name));
        assert.ok(!names.includes(vendor.role_name));
        assert.equal((await get(`${DETAILS}/${vendor.role_oid}`, owner.token)).status, 404);
        assert.ok((await get(`${LIST}?limit=100`, vendor.token)).body.data.rows.some((r) => r.name === vendor.role_name));
    });

    it("offer in the tree only the actions the person making the role holds, each with its sensitivity", async () => {
        const owner = await person([...ROLES, ...CATEGORY]);
        await h.query("UPDATE permission SET is_sensitive = true WHERE code = 'configuration.category.create'");
        const { actions } = (await get(TREE, owner.token)).body.data;
        assert.deepEqual(actions.map((a) => a.code).sort(), [...ROLES, ...CATEGORY].sort());
        assert.equal(actions.find((a) => a.code === "configuration.category.create").is_sensitive, true);
    });

    it("are created with any combination the person holds, recorded, and refuse what they do not hold", async () => {
        const owner = await person([...ROLES, ...CATEGORY]);
        await h.seed_user({ email: "other@arithmalabs.test", permissions: ["configuration.brands.view"] });

        const refused = await create(owner.token, { codes: ["configuration.category.view", "configuration.brands.view"] });
        assert.equal(refused.status, 403);

        const made = await create(owner.token, { name: "Counter", codes: CATEGORY });
        assert.equal(made.status, 200, JSON.stringify(made.body));
        const role = await details(made.body.data.oid, owner.token);
        assert.deepEqual([role.details.scope, role.codes.sort()], ["business", [...CATEGORY].sort()]);
        assert.equal(role.activity[0].action, "Created role");
    });

    it("need View before any other action of a feature, and at least one action", async () => {
        const owner = await person([...ROLES, ...CATEGORY]);
        const no_view = await create(owner.token, { codes: ["configuration.category.create"] });
        assert.deepEqual([no_view.status, /needs View/.test(no_view.body.message)], [400, true]);
        assert.equal((await create(owner.token, { codes: [] })).status, 400);
    });

    it("refuse a second role with the same name, ignoring case and spaces", async () => {
        const owner = await person([...ROLES, ...CATEGORY]);
        assert.equal((await create(owner.token, { name: "Store manager", codes: CATEGORY })).status, 200);
        assert.equal((await create(owner.token, { name: "  store MANAGER ", codes: CATEGORY })).status, 409);
    });

    it("never give a business role a system action, even from the system admin", async () => {
        const vendor = await person([...ROLES, ...SYSTEM_KEPT, ...CATEGORY], { system: true });
        assert.equal((await create(vendor.token, { codes: ["configuration.category.view", "system.feature.view"] })).status, 403);
    });

    it("change what every holder can do on their next request, and say who it reached", async () => {
        const owner = await person([...ROLES, ...CATEGORY]);
        const made = await create(owner.token, { codes: ["administration.role.view"] });
        const oid = made.body.data.oid;
        const clerk = await h.seed_user({ email: "clerk@arithmalabs.test" });
        await h.query("UPDATE login SET role_oid = $1 WHERE email = $2", [oid, clerk.email]);
        const clerk_token = (await h.sign_in(clerk)).access;
        assert.equal((await get(`${CATEGORIES}?limit=5`, clerk_token)).status, 403);

        const role = await details(oid, owner.token);
        const saved = await h.call(UPDATE, { token: owner.token, body: { oid, name: role.details.name, codes: ["configuration.category.view"], version: role.details.version } });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.deepEqual([saved.body.data.added, saved.body.data.removed, saved.body.data.holders], [["configuration.category.view"], ["administration.role.view"], 1]);
        assert.equal((await get(`${CATEGORIES}?limit=5`, clerk_token)).status, 200);
    });

    it("keep the actions the editor was not shown when they save", async () => {
        const vendor = await person([...ROLES, ...SYSTEM_KEPT, ...CATEGORY, "configuration.brands.view"], { system: true });
        const oid = (await create(vendor.token, { codes: ["configuration.category.view", "configuration.brands.view"] })).body.data.oid;
        const owner = await person([...ROLES, ...CATEGORY]);
        const role = await details(oid, owner.token);
        const saved = await h.call(UPDATE, { token: owner.token, body: { oid, name: role.details.name, codes: CATEGORY, version: role.details.version } });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.deepEqual((await details(oid, owner.token)).codes.sort(), ["configuration.brands.view", ...CATEGORY].sort());
    });

    it("refuse a save made against an older version of the role", async () => {
        const owner = await person([...ROLES, ...CATEGORY]);
        const oid = (await create(owner.token, { codes: CATEGORY })).body.data.oid;
        const { details: role } = await details(oid, owner.token);
        assert.equal((await h.call(UPDATE, { token: owner.token, body: { oid, name: "First", codes: CATEGORY, version: role.version } })).status, 200);
        const stale = await h.call(UPDATE, { token: owner.token, body: { oid, name: "Second", codes: ["configuration.category.view"], version: role.version } });
        assert.deepEqual([stale.status, stale.body.data.codes.sort()], [409, [...CATEGORY].sort()]);
    });

    it("leave the Owner role to the system admin, and keep the system admin able to undo anything", async () => {
        const owner = await person(ROLES);
        await h.query("UPDATE role SET is_system = true WHERE oid = $1", [owner.role_oid]);
        const mine = await details(owner.role_oid, owner.token);
        assert.equal(mine.details.editable, false);
        assert.equal((await h.call(UPDATE, { token: owner.token, body: { oid: owner.role_oid, name: owner.role_name, codes: ["administration.role.view"], version: mine.details.version } })).status, 403);

        const vendor = await person([...ROLES, ...SYSTEM_KEPT], { system: true });
        const own = await details(vendor.role_oid, vendor.token);
        const locked = await h.call(UPDATE, { token: vendor.token, body: { oid: vendor.role_oid, name: vendor.role_name, codes: ROLES, version: own.details.version } });
        assert.equal(locked.status, 400);
        assert.equal((await h.call(STATUS, { token: vendor.token, body: { oid: owner.role_oid, status: "Inactive" } })).status, 400);
        assert.equal((await h.call(DELETE, { token: vendor.token, body: { oid: owner.role_oid } })).status, 400);
    });

    it("withdrawn from the owner, close the roles pages to them on their next request", async () => {
        const vendor = await person([...ROLES, ...SYSTEM_KEPT, "dashboard.overview.view"], { system: true });
        const owner = await person([...ROLES, "dashboard.overview.view"]);
        assert.equal((await get(LIST, owner.token)).status, 200);
        const role = await details(owner.role_oid, vendor.token);
        const saved = await h.call(UPDATE, { token: vendor.token, body: { oid: owner.role_oid, name: owner.role_name, codes: ["dashboard.overview.view"], version: role.details.version } });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.equal((await get(LIST, owner.token)).status, 403);
    });

    it("turned off, refuse their holders everything until turned on", async () => {
        const owner = await person([...ROLES, ...CATEGORY]);
        const oid = (await create(owner.token, { codes: CATEGORY })).body.data.oid;
        const clerk = await h.seed_user({ email: "clerk@arithmalabs.test" });
        await h.query("UPDATE login SET role_oid = $1 WHERE email = $2", [oid, clerk.email]);
        const clerk_token = (await h.sign_in(clerk)).access;
        assert.equal((await get(`${CATEGORIES}?limit=5`, clerk_token)).status, 200);
        assert.equal((await h.call(STATUS, { token: owner.token, body: { oid, status: "Inactive" } })).status, 200);
        assert.equal((await get(`${CATEGORIES}?limit=5`, clerk_token)).status, 403);
        assert.deepEqual((await get(h.ROUTE.ME, clerk_token)).body.data.permissions, [], "the menu holds nothing either");
        await h.call(STATUS, { token: owner.token, body: { oid, status: "Active" } });
        assert.equal((await get(`${CATEGORIES}?limit=5`, clerk_token)).status, 200);
    });

    it("cannot be turned off by someone who holds them", async () => {
        const manager = await person([...ROLES, ...CATEGORY]);
        const res = await h.call(STATUS, { token: manager.token, body: { oid: manager.role_oid, status: "Inactive" } });
        assert.equal(res.status, 400);
        assert.equal((await get(LIST, manager.token)).status, 200);
    });

    it("delete only when nobody holds them", async () => {
        const owner = await person([...ROLES, ...CATEGORY]);
        const oid = (await create(owner.token, { codes: CATEGORY })).body.data.oid;
        const clerk = await h.seed_user({ email: "clerk@arithmalabs.test" });
        await h.query("UPDATE login SET role_oid = $1 WHERE email = $2", [oid, clerk.email]);
        const held = await h.call(DELETE, { token: owner.token, body: { oid } });
        assert.deepEqual([held.status, held.body.data.holders], [409, 1]);
        await h.query("UPDATE login SET role_oid = NULL WHERE email = $1", [clerk.email]);
        assert.equal((await h.call(DELETE, { token: owner.token, body: { oid } })).status, 200);
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM role WHERE oid = $1", [oid]))[0].n, 0);
    });

    it("raise the config version with every change", async () => {
        const owner = await person([...ROLES, ...CATEGORY]);
        const version = async () => (await h.query("SELECT version FROM config_version"))[0].version;
        const before = await version();
        const oid = (await create(owner.token, { codes: CATEGORY })).body.data.oid;
        const after_create = await version();
        assert.ok(after_create > before);
        await h.call(STATUS, { token: owner.token, body: { oid, status: "Inactive" } });
        assert.ok((await version()) > after_create);
    });
});

describe("marking an action sensitive", () => {
    beforeEach(h.reset);

    it("is the system admin's, and changes what the role tree tags", async () => {
        const owner = await person([...ROLES, ...CATEGORY]);
        assert.equal((await h.call(SENSITIVE, { token: owner.token, body: { code: "configuration.category.create", is_sensitive: true } })).status, 403);
        const vendor = await person([...ROLES, ...SYSTEM_KEPT, ...CATEGORY], { system: true });
        assert.equal((await h.call(SENSITIVE, { token: vendor.token, body: { code: "configuration.category.create", is_sensitive: true } })).status, 200);
        const { actions } = (await get(TREE, owner.token)).body.data;
        assert.equal(actions.find((a) => a.code === "configuration.category.create").is_sensitive, true);
    });
});
