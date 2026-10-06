const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.SALES + SUB_CONTEXTS.SETTINGS;
const LIST = BASE + ROUTES.GET_MESSAGE_TEMPLATES;
const SAVE = BASE + ROUTES.SAVE_MESSAGE_TEMPLATE;
const COPIED = BASE + ROUTES.RECORD_MESSAGE_COPIED;

before(h.start);
after(h.stop);

let seq = 0;
const person = async (permissions) => (await h.sign_in(await h.seed_user({ email: `templates${++seq}@arithmalabs.test`, permissions }))).access;
const template = { name: "Order received", language: "en", body: "Hi {customer_name}, we got order {invoice_no}. Total {total}.", order_statuses: ["Pending"] };

describe("message templates", () => {
    beforeEach(async () => {
        await h.reset();
        await h.query("TRUNCATE message_template");
    });

    it("lets the business add, word and switch off its own templates, each change logged", async () => {
        const owner = await person(["sales.settings.view", "sales.settings.edit"]);
        const added = await h.call(SAVE, { body: template, token: owner });
        assert.equal(added.status, 200, JSON.stringify(added.body));
        const oid = added.body.data.oid;
        assert.equal((await h.call(SAVE, { body: { ...template, name: "order RECEIVED" }, token: owner })).status, 409, "same name and language twice");
        assert.equal((await h.call(SAVE, { body: { ...template, language: "bn", body: "{customer_name}, অর্ডার {invoice_no} পেয়েছি।" }, token: owner })).status, 200, "the same name in Bengali is its own template");
        assert.equal((await h.call(SAVE, { body: { ...template, oid, status: "Inactive", order_statuses: ["Pending", "Nope"] }, token: owner })).status, 400, "only known stages");
        assert.equal((await h.call(SAVE, { body: { ...template, oid, status: "Inactive" }, token: owner })).status, 200);

        const list = await h.call(LIST, { method: "GET", token: owner });
        const mine = list.body.data.find((t) => t.oid === oid);
        assert.deepEqual([mine.status, mine.order_statuses], ["Inactive", ["Pending"]]);
        const logged = await h.query("SELECT title FROM activity_log WHERE reference_oid = $1 ORDER BY performed_on", [oid]);
        assert.deepEqual(logged.map((r) => r.title), ["Added message template", "Updated message template"]);
    });

    it("lets someone who handles orders read the templates but never change them", async () => {
        const moderator = await person(["sales.order-history.view"]);
        assert.equal((await h.call(LIST, { method: "GET", token: moderator })).status, 200);
        assert.equal((await h.call(SAVE, { body: template, token: moderator })).status, 403);
        assert.equal((await h.call(LIST, { method: "GET", token: await person(["sales.pos.view"]) })).status, 403);
        assert.equal((await h.call(LIST, { method: "GET" })).status, 401);
    });

    it("refuses to log a copy against an order that is not there", async () => {
        const owner = await person(["sales.settings.edit", "sales.order.view"]);
        const oid = (await h.call(SAVE, { body: template, token: owner })).body.data.oid;
        assert.equal((await h.call(COPIED, { body: { order_oid: uuidv4(), template_oid: oid }, token: owner })).status, 404);
    });
});
