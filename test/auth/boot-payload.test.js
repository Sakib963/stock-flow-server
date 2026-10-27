const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("../support/harness");

before(h.start);
after(h.stop);

describe("reloading the boot payload", () => {
    let access;

    beforeEach(async () => {
        await h.reset();
        ({ access } = await h.sign_in(await h.seed_user()));
    });

    const me = (etag) => h.call(h.ROUTE.ME, { method: "GET", token: access, headers: etag ? { "if-none-match": etag } : {} });

    it("answers 304 with nothing in it when nothing changed, so a reload costs one small read", async () => {
        const first = await me();
        assert.equal(first.status, 200);
        assert.ok(first.etag);

        const again = await me(first.etag);

        assert.equal(again.status, 304);
        assert.equal(again.body, null);
    });

    it("sends the whole payload again once a role, grant, menu item or setting changed", async () => {
        const first = await me();
        await h.query("UPDATE config_version SET version = version + 1");

        const again = await me(first.etag);

        assert.equal(again.status, 200);
        assert.notEqual(again.etag, first.etag);
        assert.ok(again.body.data.user);
    });

    it("sends it again when the person's own record changed, which no config version covers", async () => {
        const first = await me();
        await h.query("UPDATE login SET edited_on = clock_timestamp() + interval '1 second'");

        assert.equal((await me(first.etag)).status, 200);
    });
});
