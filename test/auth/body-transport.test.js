const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("../support/harness");

// Hosting that puts the web app and the API on different sites (two *.vercel.app addresses, a
// github.io page) cannot use the cookie, so the token travels in the body instead. Everything
// else about the lifecycle must be identical, and the cookie must be ignored.
describe("body transport", () => {
    let user;

    before(async () => {
        process.env.AUTH_REFRESH_TRANSPORT = "body";
        await h.start();
    });

    after(async () => {
        process.env.AUTH_REFRESH_TRANSPORT = "cookie";
        await h.stop();
    });

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user();
    });

    it("hands the refresh token over in the body and sets no cookie", async () => {
        const { res } = await h.sign_in(user);

        assert.equal(res.body.data.refresh_transport, "body");
        assert.equal(typeof res.body.data.refresh_token, "string");
        assert.equal(res.body.data.refresh_token.length, 43);
        assert.equal(res.set_cookie, null);
    });

    it("rotates a token sent in the body", async () => {
        const signed = await h.sign_in(user);

        const res = await h.refresh(signed.refresh);

        assert.equal(res.status, 200);
        assert.notEqual(res.body.data.refresh_token, signed.refresh);
        assert.equal((await h.token_row(signed.refresh)).status, "Rotated");
    });

    it("ignores a refresh cookie", async () => {
        const signed = await h.sign_in(user);

        const res = await h.call(h.ROUTE.REFRESH, { cookie: signed.refresh });

        assert.equal(res.status, 401);
        assert.equal(res.body.data.reason, "missing");
    });

    it("still ends the session when a replaced token is reused", async () => {
        const signed = await h.sign_in(user);
        const first = await h.refresh(signed.refresh);
        await h.refresh(first.body.data.refresh_token);

        const copy = await h.refresh(signed.refresh);

        assert.equal(copy.body.data.reason, "reuse");
        assert.equal((await h.session(signed.session_id)).status, "Revoked");
    });

    it("ends the session whose token the browser sends with a new sign-in", async () => {
        const held = await h.sign_in(user, { remember: true });

        const res = await h.call(h.ROUTE.SIGN_IN, { body: { email: user.email, password: user.password, remember: true, refresh_token: held.refresh } });

        assert.equal(res.status, 200);
        assert.equal((await h.session(held.session_id)).status, "SignedOut");
        assert.equal((await h.session(res.body.data.session_id)).status, "Active");
    });

    it("ignores a refresh cookie on sign-in, the same as everywhere else", async () => {
        const held = await h.sign_in(user, { remember: true });

        await h.call(h.ROUTE.SIGN_IN, { body: { email: user.email, password: user.password }, cookie: held.refresh });

        assert.equal((await h.session(held.session_id)).status, "Active");
    });

    it("signs out with the token in the body", async () => {
        const signed = await h.sign_in(user);

        const res = await h.call(h.ROUTE.SIGN_OUT, { body: { refresh_token: signed.refresh } });

        assert.equal(res.body.data.sessions_closed, 1);
    });
});
