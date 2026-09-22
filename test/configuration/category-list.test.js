const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const ROUTE = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.CATEGORY + ROUTES.GET_CATEGORY_LIST;

before(h.start);
after(h.stop);

const list = (token, params = {}) => h.call(`${ROUTE}?${new URLSearchParams(params)}`, { method: "GET", token });

const seed_category = (name, code, status = "Active", created_on = new Date()) => h.query("INSERT INTO categories (oid, name, category_code, status, created_on) VALUES ($1, $2, $3, $4, $5)", [uuidv4(), name, code, status, created_on]);

describe("the categories list", () => {
    let viewer;
    let role_name;

    beforeEach(async () => {
        await h.reset();
        const user = await h.seed_user({ permissions: ["configuration.category.view"] });
        role_name = user.role_name;
        viewer = (await h.sign_in(user)).access;

        await seed_category("Saree", "SAR", "Active");
        await seed_category("Kurti", "KUR", "Active");
        await seed_category("Panjabi", "PAN", "Inactive");
        await seed_category("Three piece 50% off", "TPO", "Active");
    });

    it("refuses someone signed in without the view permission", async () => {
        await h.query("TRUNCATE login, role, role_permission CASCADE");
        const other = await h.seed_user({ email: "counter@samiha.test", permissions: ["dashboard.overview.view"] });
        const { access } = await h.sign_in(other);

        const res = await list(access);
        assert.equal(res.status, 403);
    });

    it("refuses a request with no token as signed out, not as forbidden", async () => {
        const res = await list(undefined);
        assert.equal(res.status, 401);
    });

    it("answers a page of rows with the total over every match, in the standard list shape", async () => {
        const res = await list(viewer, { offset: 0, limit: 2 });

        assert.equal(res.status, 200);
        assert.equal(res.body.total, 4);
        assert.equal(res.body.data.rows.length, 2);
        assert.deepEqual(Object.keys(res.body.data.rows[0]).sort(), ["category_code", "created_on", "description", "last_action_by", "last_action_by_name", "last_action_by_role", "last_action_is_edit", "last_action_on", "name", "oid", "status"]);
    });

    it("sorts by name unless asked otherwise, and pages without repeating or skipping a row", async () => {
        const first = await list(viewer, { offset: 0, limit: 2 });
        const second = await list(viewer, { offset: 2, limit: 2 });

        assert.deepEqual([...first.body.data.rows, ...second.body.data.rows].map((r) => r.name), ["Kurti", "Panjabi", "Saree", "Three piece 50% off"]);
    });

    it("finds a category by its name or its code, whatever the case", async () => {
        const by_name = await list(viewer, { search: "sar" });
        const by_code = await list(viewer, { search: "kur" });

        assert.deepEqual(by_name.body.data.rows.map((r) => r.name), ["Saree"]);
        assert.deepEqual(by_code.body.data.rows.map((r) => r.name), ["Kurti"]);
        assert.equal(by_name.body.total, 1);
    });

    it("treats a percent sign in the search as a character, not a wildcard", async () => {
        const res = await list(viewer, { search: "50%" });

        assert.deepEqual(res.body.data.rows.map((r) => r.name), ["Three piece 50% off"]);
    });

    it("filters by one status or several, and counts only what matches", async () => {
        const inactive = await list(viewer, { status: "Inactive" });
        const both = await list(viewer, { status: "Active,Inactive" });

        assert.deepEqual(inactive.body.data.rows.map((r) => r.name), ["Panjabi"]);
        assert.equal(inactive.body.total, 1);
        assert.equal(both.body.total, 4);
    });

    it("sorts by a column it offers, in either direction", async () => {
        const res = await list(viewer, { sort: "category_code", order: "desc" });

        assert.deepEqual(res.body.data.rows.map((r) => r.category_code), ["TPO", "SAR", "PAN", "KUR"]);
    });

    it("refuses to sort by a column it does not offer, so nothing else can reach the query", async () => {
        const res = await list(viewer, { sort: "created_by; DROP TABLE categories" });

        assert.equal(res.status, 400);
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM categories"))[0].n, 4);
    });

    it("says who last touched a row by name, and that an edit is what it was", async () => {
        await h.query("UPDATE categories SET created_by = $1 WHERE name = 'Saree'", ["owner@samiha.test"]);
        await h.query("UPDATE categories SET created_by = $1, edited_by = $1, edited_on = $2 WHERE name = 'Kurti'", ["owner@samiha.test", new Date()]);

        const rows = (await list(viewer, { limit: 100 })).body.data.rows;
        const saree = rows.find((r) => r.name === "Saree");
        const kurti = rows.find((r) => r.name === "Kurti");

        assert.equal(saree.last_action_by, "owner@samiha.test");
        assert.equal(saree.last_action_by_name, "Samiha Rahman");
        assert.equal(saree.last_action_by_role, role_name);
        assert.equal(saree.last_action_is_edit, false);
        assert.equal(kurti.last_action_is_edit, true);
        assert.equal(new Date(kurti.last_action_on) > new Date(saree.last_action_on), true);
    });

    it("leaves the name empty rather than dropping the row when the account that made it is gone", async () => {
        await h.query("UPDATE categories SET created_by = 'left@samiha.test' WHERE name = 'Panjabi'");

        const res = await list(viewer, { limit: 100 });
        const panjabi = res.body.data.rows.find((r) => r.name === "Panjabi");

        assert.equal(res.body.total, 4);
        assert.equal(panjabi.last_action_by, "left@samiha.test");
        assert.equal(panjabi.last_action_by_name, null);
    });

    it("sorts by who last touched the row, which is an edit time or a creation time", async () => {
        const old_day = new Date("2026-01-01T10:00:00");
        await h.query("UPDATE categories SET created_on = $1 WHERE name = 'Saree'", [old_day]);
        await h.query("UPDATE categories SET created_on = $1, edited_on = $2, edited_by = 'owner@samiha.test' WHERE name = 'Kurti'", [old_day, new Date()]);

        const res = await list(viewer, { sort: "last_action_on", order: "asc", limit: 100 });

        assert.equal(res.body.data.rows[0].name, "Saree");
        assert.equal(res.body.data.rows.at(-1).name, "Kurti");
    });

    it("answers an empty page past the end with the real total, so the list can step back", async () => {
        const res = await list(viewer, { offset: 40, limit: 20 });

        assert.equal(res.body.data.rows.length, 0);
        assert.equal(res.body.total, 4);
    });
});
