const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("../support/harness");
const app = require("../../server");
const database = require("../../src/db/database");
const { redact, capped } = require("../../src/middleware/request-log");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const CATEGORY_LIST = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.CATEGORY + ROUTES.GET_CATEGORY_LIST;

app.get("/test/boom", (request, res) => res.status(500).json({ code: 500, message: "Something Went Wrong!" }));

const row_of = async (request_id) => (await h.query("SELECT * FROM api_request_log WHERE oid = $1", [request_id]))[0];

before(h.start);
after(h.stop);
beforeEach(async () => {
    await h.reset();
    await h.query("TRUNCATE api_request_log");
});

describe("request log", () => {
    it("records a read with its route template, status, account and no bodies, before the response arrives", async () => {
        const user = await h.seed_user({ permissions: ["configuration.category.view"] });
        const { access } = await h.sign_in(user);
        const res = await h.call(`${CATEGORY_LIST}?limit=20`, { method: "GET", token: access });

        const row = await row_of(res.request_id);
        assert.equal(res.status, 200);
        assert.equal(row.route, CATEGORY_LIST);
        assert.equal(row.path, `${CATEGORY_LIST}?limit=20`);
        assert.equal(row.status, 200);
        assert.equal(row.login_oid, user.oid);
        assert.equal(row.unmatched_route, false);
        assert.equal(row.request_body, null);
        assert.equal(row.response_body, null);
        assert.ok(row.response_bytes > 0);
    });

    it("keeps a sign-in body with the password redacted, and never the tokens it answers with", async () => {
        const user = await h.seed_user();
        const res = await h.call(h.ROUTE.SIGN_IN, { body: { email: user.email, password: user.password, remember: false } });

        const row = await row_of(res.request_id);
        assert.equal(res.status, 200);
        assert.deepEqual(row.request_body, { email: user.email, password: "[redacted]", remember: false });
        assert.equal(row.response_body, null);
        assert.ok(!JSON.stringify(row).includes(user.password));
    });

    it("records a request refused before any controller, with no account", async () => {
        const res = await h.call(CATEGORY_LIST, { method: "GET" });

        const row = await row_of(res.request_id);
        assert.equal(res.status, 401);
        assert.equal(row.status, 401);
        assert.equal(row.login_oid, null);
    });

    it("records an unknown path as itself, marked unmatched", async () => {
        const res = await h.call("/wp-admin", { method: "GET" });

        const row = await row_of(res.request_id);
        assert.equal(res.status, 404);
        assert.equal(row.route, "/wp-admin");
        assert.equal(row.unmatched_route, true);
    });

    it("keeps the response body of a server error", async () => {
        const res = await h.call("/test/boom", { method: "GET" });

        const row = await row_of(res.request_id);
        assert.equal(row.status, 500);
        assert.deepEqual(row.response_body, { code: 500, message: "Something Went Wrong!" });
    });

    it("sends the response unchanged when the log cannot be written", async () => {
        const original = database.execute_value;
        database.execute_value = async () => {
            throw new Error("database refused");
        };
        try {
            const res = await h.call("/test/boom", { method: "GET" });
            assert.equal(res.status, 500);
            assert.deepEqual(res.body, { code: 500, message: "Something Went Wrong!" });
        } finally {
            database.execute_value = original;
        }
    });
});

describe("redact", () => {
    it("replaces every credential at any depth, whatever the case", () => {
        const body = { email: "a@b.test", Password: "x", nested: { refresh_token: "y", list: [{ OTP: "123456", keep: 1 }] } };

        assert.deepEqual(redact(body), { email: "a@b.test", Password: "[redacted]", nested: { refresh_token: "[redacted]", list: [{ OTP: "[redacted]", keep: 1 }] } });
    });

    it("keeps an oversized body as its size and opening rather than whole", () => {
        const stored = JSON.parse(capped({ note: "x".repeat(100) }, 50));

        assert.equal(stored.truncated, true);
        assert.equal(stored.head.length, 50);
        assert.ok(stored.bytes > 100);
    });
});
