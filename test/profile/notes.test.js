const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const NOTES = CONTEXTS.PROFILE + SUB_CONTEXTS.NOTES;
const LIST = NOTES + ROUTES.GET_USER_NOTE_LIST;
const CREATE = NOTES + ROUTES.CREATE_USER_NOTE;
const UPDATE = NOTES + ROUTES.UPDATE_USER_NOTE;
const DELETE = NOTES + ROUTES.DELETE_USER_NOTE;

before(h.start);
after(h.stop);

let seq = 0;
// No permission at all: notes are every signed-in person's own.
const person = async () => (await h.sign_in(await h.seed_user({ email: `writer${++seq}@arithmalabs.test`, permissions: [] }))).access;
const list = async (token) => (await h.call(LIST, { method: "GET", token })).body.data;
const write = (token, oid, note_title, note_text) => h.call(CREATE, { body: { oid, note_title, note_text }, token });

describe("a person's own notes", () => {
    let me;
    beforeEach(async () => {
        await h.reset();
        await h.query("TRUNCATE user_notes, api_request_log");
        me = await person();
    });

    it("keeps a note for whoever wrote it, needing no permission, the one touched last first", async () => {
        const first = uuidv4();
        const second = uuidv4();
        assert.equal((await write(me, first, "Call the supplier", "About the late kurti batch")).status, 200);
        assert.equal((await write(me, second, null, "Order more courier bags")).status, 200);
        assert.deepEqual((await list(me)).map((note) => note.oid), [second, first]);

        assert.equal((await h.call(UPDATE, { body: { oid: first, note_title: "Call the supplier", note_text: "Done" }, token: me })).status, 200);
        const notes = await list(me);
        assert.deepEqual(notes.map((note) => note.oid), [first, second], "an edit brings it back to the top");
        assert.equal(notes[0].note_text, "Done");
    });

    it("keeps tags optional: none is stored as nothing, and only the fixed set is taken", async () => {
        const plain = uuidv4();
        await write(me, plain, "No tags", null);
        const tagged = uuidv4();
        assert.equal((await h.call(CREATE, { body: { oid: tagged, note_title: "Chase payment", note_text: null, tags: ["payment", "important"] }, token: me })).status, 200);
        const byOid = Object.fromEntries((await list(me)).map((note) => [note.oid, note.tags]));
        assert.equal(byOid[plain], null);
        assert.deepEqual(byOid[tagged], ["payment", "important"]);

        assert.equal((await h.call(UPDATE, { body: { oid: tagged, note_title: "Chase payment", note_text: null, tags: [] }, token: me })).status, 200);
        const [row] = await h.query("SELECT tags FROM user_notes WHERE oid = $1", [tagged]);
        assert.equal(row.tags, null, "taking every tag off stores null, not an empty list");
        assert.equal((await h.call(CREATE, { body: { oid: uuidv4(), note_title: "x", note_text: null, tags: ["urgent-ish"] }, token: me })).status, 400);
    });

    it("never shows, changes or deletes someone else's note", async () => {
        const mine = uuidv4();
        await write(me, mine, "Mine", null);
        const other = await person();
        assert.deepEqual(await list(other), []);
        assert.equal((await h.call(UPDATE, { body: { oid: mine, note_title: "Taken", note_text: null }, token: other })).status, 404);
        assert.equal((await h.call(DELETE, { body: { oid: mine }, token: other })).status, 404);
        assert.equal((await write(other, mine, "Same id", null)).status, 409, "an id already used is not another person's to save into");
        assert.equal((await list(me))[0].note_title, "Mine");
    });

    it("gives back the same note when a save is repeated after a lost answer", async () => {
        const oid = uuidv4();
        await write(me, oid, "Once", null);
        assert.equal((await write(me, oid, "Once", null)).status, 200);
        assert.equal((await list(me)).length, 1);
    });

    it("refuses an empty note, and says a deleted one is gone", async () => {
        assert.equal((await write(me, uuidv4(), "  ", "")).status, 400);
        const oid = uuidv4();
        await write(me, oid, "Short lived", null);
        assert.equal((await h.call(DELETE, { body: { oid }, token: me })).status, 200);
        assert.equal((await h.call(DELETE, { body: { oid }, token: me })).status, 404);
        assert.equal((await h.call(UPDATE, { body: { oid, note_title: "Back", note_text: null }, token: me })).status, 404);
    });

    it("keeps what a person wrote out of the request log", async () => {
        const res = await write(me, uuidv4(), "Private title", "Private text");
        const [row] = await h.query("SELECT request_body FROM api_request_log WHERE oid = $1", [res.request_id]);
        assert.equal(row.request_body.note_title, "[redacted]");
        assert.equal(row.request_body.note_text, "[redacted]");
    });

    it("refuses every note action without a sign in", async () => {
        assert.equal((await h.call(LIST, { method: "GET" })).status, 401);
        assert.equal((await write(null, uuidv4(), "x", null)).status, 401);
    });
});
