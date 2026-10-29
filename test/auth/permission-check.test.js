const { describe, it, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("../support/harness");
const pool = require("../../src/db/db.config");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const LIST = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.AISLE + ROUTES.GET_AISLE_LIST;

before(h.start);
after(h.stop);

describe("the permission check", () => {
    let user;
    let token;
    let texts;
    const original = pool.query;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user({ permissions: ["configuration.aisle.view"] });
        token = (await h.sign_in(user)).access;
        texts = [];
        pool.query = function (query, ...rest) {
            texts.push(typeof query === "string" ? query : query.text);
            return original.call(this, query, ...rest);
        };
    });

    afterEach(() => {
        pool.query = original;
    });

    const list = () => h.call(LIST, { method: "GET", token });

    it("reads the person's permissions and the config version once, in the session check", async () => {
        assert.equal((await list()).status, 200);

        assert.equal(texts.filter((t) => t.includes("role_permission")).length, 1);
        assert.equal(texts.filter((t) => /FROM\s+config_version/.test(t)).length, 1);
    });

    it("refuses a page the person does not hold", async () => {
        await h.query("DELETE FROM role_permission WHERE role_oid = (SELECT role_oid FROM login WHERE oid = $1)", [user.oid]);
        assert.equal((await list()).status, 403);
    });

    it("grants nothing through a role that has been turned off, from the next request", async () => {
        await h.query("UPDATE role SET status = 'Inactive' WHERE oid = (SELECT role_oid FROM login WHERE oid = $1)", [user.oid]);
        assert.equal((await list()).status, 403);
    });
});
