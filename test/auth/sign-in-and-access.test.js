const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const h = require("../support/harness");

before(h.start);
after(h.stop);

describe("sign-in", () => {
    let user;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user();
    });

    it("opens a session, sets an HttpOnly refresh cookie, and puts only the access token in the body", async () => {
        const res = await h.call(h.ROUTE.SIGN_IN, { body: { email: user.email, password: user.password } });

        assert.equal(res.status, 200);
        const data = res.body.data;
        assert.equal(data.expires_in, 900);
        assert.equal(data.refresh_transport, "cookie");
        assert.equal(data.refresh_token, undefined);
        assert.deepEqual(data.user, { id: user.oid, email: user.email, name: "Samiha Rahman", role: user.role_name });

        assert.match(res.set_cookie, /HttpOnly/i);
        assert.match(res.set_cookie, /SameSite=Strict/i);
        assert.match(res.set_cookie, /Path=\/api\/v1\/auth/);
        assert.doesNotMatch(res.set_cookie, /Max-Age|Expires/i, "not kept signed in means a browser-session cookie");

        const session = await h.session(data.session_id);
        assert.equal(session.login_oid, user.oid);
        assert.equal(session.status, "Active");

        const tokens = await h.query("SELECT token_hash, status FROM auth_refresh_token");
        assert.equal(tokens.length, 1);
        assert.equal(tokens[0].token_hash, h.hash(res.cookie), "stored as a hash, never the token itself");
        assert.equal((await h.events("LOGIN_SUCCESS")).length, 1);
    });

    it("puts nothing in the access token but the account, the session and its times", async () => {
        const { access, session_id } = await h.sign_in(user);
        const claims = jwt.decode(access);

        assert.deepEqual(Object.keys(claims).sort(), ["exp", "iat", "sid", "sub"]);
        assert.equal(claims.sub, user.oid);
        assert.equal(claims.sid, session_id);
        assert.equal(claims.exp - claims.iat, 900);
    });

    it("keeps the cookie beyond the browser session only when asked to", async () => {
        const { res } = await h.sign_in(user, { remember: true });

        assert.match(res.set_cookie, /Max-Age=604800/);
        assert.equal((await h.session(res.body.data.session_id)).remember, true);
    });

    it("matches the email whatever its case", async () => {
        const res = await h.call(h.ROUTE.SIGN_IN, { body: { email: "  OWNER@Samiha.TEST ", password: user.password } });

        assert.equal(res.status, 200);
    });

    it("gives an unknown email and a wrong password the same answer, and opens nothing", async () => {
        const unknown = await h.call(h.ROUTE.SIGN_IN, { body: { email: "nobody@samiha.test", password: user.password } });
        const wrong = await h.call(h.ROUTE.SIGN_IN, { body: { email: user.email, password: "Not-the-password-1" } });

        assert.equal(unknown.status, 401);
        assert.deepEqual(unknown.body, wrong.body);
        assert.equal(unknown.set_cookie, null);
        assert.equal((await h.query("SELECT oid FROM auth_session")).length, 0);
        assert.equal((await h.events("LOGIN_FAILED")).length, 2);
    });

    it("refuses a turned-off account even with the right password", async () => {
        const off = await h.seed_user({ email: "former@samiha.test", status: "Inactive" });

        const res = await h.call(h.ROUTE.SIGN_IN, { body: { email: off.email, password: off.password } });

        assert.equal(res.status, 403);
        assert.equal((await h.query("SELECT oid FROM auth_session")).length, 0);
    });

    it("refuses a malformed request", async () => {
        const res = await h.call(h.ROUTE.SIGN_IN, { body: { email: user.email } });

        assert.equal(res.status, 400);
    });

    it("throttles repeated guessing at one account", async () => {
        for (let attempt = 0; attempt < 10; attempt++) {
            assert.equal((await h.call(h.ROUTE.SIGN_IN, { body: { email: user.email, password: `Guess-${attempt}` } })).status, 401);
        }

        const res = await h.call(h.ROUTE.SIGN_IN, { body: { email: user.email, password: user.password } });

        assert.equal(res.status, 429);
    });
});

/**
 * A browser that signs in again while it still holds a session, such as one whose renewal failed on
 * a dead connection at start-up, would otherwise leave that session open and listed as a device
 * nobody can reach.
 */
describe("signing in again on the same browser", () => {
    let user;
    let before_;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user();
        before_ = await h.sign_in(user, { remember: true });
    });

    const sign_in_holding = (token, credentials = user) => h.call(h.ROUTE.SIGN_IN, { body: { email: credentials.email, password: credentials.password, remember: true }, cookie: token });
    const me = (token) => h.call(h.ROUTE.ME, { method: "GET", token });

    it("ends the session the browser already held, so it is not left behind as a phantom device", async () => {
        const res = await sign_in_holding(before_.refresh);

        assert.equal(res.status, 200);
        const old = await h.session(before_.session_id);
        assert.equal(old.status, "SignedOut");
        assert.equal(old.end_reason, "SignOut");
        assert.equal((await h.refresh(before_.refresh)).status, 401);
        assert.equal((await me(before_.access)).status, 401);

        const active = await h.query("SELECT oid FROM auth_session WHERE status = 'Active'");
        assert.deepEqual(active.map((s) => s.oid), [res.body.data.session_id]);

        const [logout] = await h.events("LOGOUT");
        assert.equal(logout.session_oid, before_.session_id);
        assert.deepEqual(logout.detail, { reason: "replaced" });
    });

    it("leaves the held session alone when the new sign-in is refused", async () => {
        const res = await sign_in_holding(before_.refresh, { email: user.email, password: "Not-the-password-1" });

        assert.equal(res.status, 401);
        assert.equal((await h.session(before_.session_id)).status, "Active");
        assert.equal((await me(before_.access)).status, 200);
    });

    /** The browser's cookie is overwritten either way, so the first person's session there is unreachable. */
    it("ends the held session even when a different account signs in on that browser", async () => {
        const colleague = await h.seed_user({ email: "rafi@samiha.test" });

        const res = await sign_in_holding(before_.refresh, colleague);

        assert.equal(res.status, 200);
        assert.equal((await h.session(before_.session_id)).status, "SignedOut");
    });

    it("never touches the account's sessions on other devices", async () => {
        const phone = await h.sign_in(user);

        await sign_in_holding(before_.refresh);

        assert.equal((await h.session(phone.session_id)).status, "Active");
    });

    /** A not-kept session in a browser that was closed: its token is gone, but the browser remembers the id. */
    it("ends this browser's last session from its id when the token is already gone", async () => {
        const res = await h.call(h.ROUTE.SIGN_IN, { body: { email: user.email, password: user.password, previous_session_id: before_.session_id } });

        assert.equal(res.status, 200);
        assert.equal((await h.session(before_.session_id)).status, "SignedOut");
        const [logout] = await h.events("LOGOUT");
        assert.deepEqual(logout.detail, { reason: "replaced" });
    });

    it("never ends another account's session from an id alone", async () => {
        const colleague = await h.seed_user({ email: "rafi@samiha.test" });

        const res = await h.call(h.ROUTE.SIGN_IN, { body: { email: colleague.email, password: colleague.password, previous_session_id: before_.session_id } });

        assert.equal(res.status, 200);
        assert.equal((await h.session(before_.session_id)).status, "Active");
    });

    it("does not let a garbled remembered id stop anyone signing in", async () => {
        const res = await h.call(h.ROUTE.SIGN_IN, { body: { email: user.email, password: user.password, previous_session_id: "not-a-session" } });

        assert.equal(res.status, 200);
        assert.equal((await h.session(before_.session_id)).status, "Active");
    });

    it("signs in normally when the held token is unknown, already spent or already ended", async () => {
        const renewed = await h.refresh(before_.refresh);
        await h.refresh(renewed.cookie);

        for (const token of ["a-token-nobody-issued", before_.refresh]) {
            assert.equal((await sign_in_holding(token)).status, 200);
        }
    });
});

describe("access token", () => {
    let user;
    let signed;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user();
        signed = await h.sign_in(user);
    });

    const me = (token) => h.call(h.ROUTE.ME, { method: "GET", token });

    it("lets a valid token through", async () => {
        assert.equal((await me(signed.access)).status, 200);
    });

    it("refuses a request with no token", async () => {
        const res = await me(null);

        assert.equal(res.status, 401);
        assert.equal(res.body.data.reason, "missing");
    });

    it("refuses an expired token, saying it expired so the client knows to renew", async () => {
        const expired = h.sign_token({ sid: signed.session_id, exp: Math.floor(Date.now() / 1000) - 10 }, { subject: user.oid });

        const res = await me(expired);

        assert.equal(res.status, 401);
        assert.equal(res.body.data.reason, "expired");
    });

    it("refuses a token whose signature was tampered with", async () => {
        const last = signed.access.at(-2) === "A" ? "B" : "A";
        const tampered = signed.access.slice(0, -2) + last + signed.access.at(-1);

        const res = await me(tampered);

        assert.equal(res.status, 401);
        assert.equal(res.body.data.reason, "invalid");
    });

    it("refuses a token signed with another algorithm, even with the right secret", async () => {
        const other = h.sign_token({ sid: signed.session_id }, { subject: user.oid, algorithm: "HS512", expiresIn: 900 });

        assert.equal((await me(other)).status, 401);
    });

    it("refuses an unsigned token", async () => {
        const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
        const unsigned = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: user.oid, sid: signed.session_id, exp: Math.floor(Date.now() / 1000) + 900 })}.`;

        assert.equal((await me(unsigned)).status, 401);
    });

    it("refuses a token that names no session", async () => {
        const sessionless = h.sign_token({}, { subject: user.oid, expiresIn: 900 });

        assert.equal((await me(sessionless)).status, 401);
    });

    it("stops working the moment the account is turned off", async () => {
        await h.query("UPDATE login SET status = 'Inactive' WHERE oid = $1", [user.oid]);

        const res = await me(signed.access);

        assert.equal(res.status, 401);
        assert.equal(res.body.data.reason, "ended");
    });

    it("stops working the moment its session ends, before the token itself expires", async () => {
        await h.query("UPDATE auth_session SET status = 'Revoked' WHERE oid = $1", [signed.session_id]);

        assert.equal((await me(signed.access)).status, 401);
    });
});
