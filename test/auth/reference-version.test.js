const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const CREATE_CATEGORY = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.CATEGORY + ROUTES.CREATE_CATEGORY;
const CREATE_NOTE = CONTEXTS.PROFILE + SUB_CONTEXTS.NOTES + ROUTES.CREATE_USER_NOTE;

before(h.start);
after(h.stop);

const version_seen_by = async (token) => {
    const res = await h.call(h.ROUTE.ME, { method: "GET", token });
    assert.equal(res.status, 200);
    return Number(res.reference_version);
};

describe("the reference version the web keeps its picker lists by", () => {
    let token;
    beforeEach(async () => {
        await h.reset();
        await h.query("TRUNCATE user_notes");
        token = (await h.sign_in(await h.seed_user({ permissions: ["configuration.category.create"] }))).access;
    });

    it("comes on every signed-in answer, as a number", async () => {
        const version = await version_seen_by(token);
        assert.ok(Number.isInteger(version) && version > 0, `got ${version}`);
    });

    it("moves forward when a category is added, so every open tab drops its kept category list", async () => {
        const before_change = await version_seen_by(token);
        const created = await h.call(CREATE_CATEGORY, { body: { name: "Bags", category_code: "BAGS", status: "Active" }, token });
        assert.equal(created.status, 200, created.body?.message);
        assert.ok((await version_seen_by(token)) > before_change);
    });

    it("moves when a supplier is edited outside any endpoint, because it reads the tables themselves", async () => {
        const supplier = uuidv4();
        await h.query("INSERT INTO supplier (oid, name, phone_number, email, status) VALUES ($1, 'Mill', '01700000001', 'mill@mill.test', 'Active')", [supplier]);
        const before_change = await version_seen_by(token);
        await new Promise((resolve) => setTimeout(resolve, 5));
        await h.query("UPDATE supplier SET status = 'Inactive', edited_on = CURRENT_TIMESTAMP WHERE oid = $1", [supplier]);
        assert.ok((await version_seen_by(token)) > before_change);
    });

    it("stays where it is after a write to something no picker lists", async () => {
        const before_change = await version_seen_by(token);
        const note = await h.call(CREATE_NOTE, { body: { oid: uuidv4(), note_title: "Call the courier", note_text: "About the late parcel" }, token });
        assert.equal(note.status, 200, note.body?.message);
        assert.equal(await version_seen_by(token), before_change);
    });
});
