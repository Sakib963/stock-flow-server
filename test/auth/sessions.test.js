const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("../support/harness");

const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

before(h.start);
after(h.stop);

const sessions = (token) => h.call(h.ROUTE.SESSIONS, { method: "GET", token });
const me = (token) => h.call(h.ROUTE.ME, { method: "GET", token });

describe("signed-in devices", () => {
    let user;
    let counter;
    let phone;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user();
        counter = await h.sign_in(user, { user_agent: CHROME_WINDOWS });
        phone = await h.sign_in(user, { user_agent: SAFARI_IPHONE });
    });

    it("lists every device signed in to the account, this one first, named the way a person recognises it", async () => {
        const res = await sessions(counter.access);

        assert.equal(res.status, 200);
        assert.equal(res.body.data.length, 2);
        const [here, other] = res.body.data;

        assert.equal(here.id, counter.session_id);
        assert.equal(here.current, true);
        assert.deepEqual(here.device, { browser: "Chrome", os: "Windows", type: "desktop" });

        assert.equal(other.id, phone.session_id);
        assert.equal(other.current, false);
        assert.deepEqual(other.device, { browser: "Safari", os: "iOS", type: "phone" });

        assert.deepEqual(Object.keys(here).sort(), ["current", "device", "id", "ip_address", "last_used_on", "remember", "signed_in_on"], "nothing about tokens leaves");
    });

    /** Stored without a zone; a server in another zone must not shift "last active" by the difference. */
    it("reports times as real instants", async () => {
        const [here] = (await sessions(counter.access)).body.data;

        assert.ok(Math.abs(Date.parse(here.signed_in_on) - Date.now()) < 60_000, `signed_in_on ${here.signed_in_on} is not now`);
        assert.ok(Math.abs(Date.parse(here.last_used_on) - Date.now()) < 60_000, `last_used_on ${here.last_used_on} is not now`);
    });

    it("leaves out other accounts, ended sessions, and sessions that can no longer renew", async () => {
        const colleague = await h.seed_user({ email: "rafi@samiha.test" });
        await h.sign_in(colleague);
        const ended = await h.sign_in(user);
        await h.call(h.ROUTE.SIGN_OUT, { cookie: ended.refresh });
        const idle = await h.sign_in(user);
        await h.query("UPDATE auth_refresh_token SET expires_on = LOCALTIMESTAMP - interval '1 minute' WHERE session_oid = $1", [idle.session_id]);

        const ids = (await sessions(counter.access)).body.data.map((s) => s.id).sort();

        assert.deepEqual(ids, [counter.session_id, phone.session_id].sort());
    });

    it("signs out one other device, and only that one", async () => {
        const res = await h.call(h.ROUTE.SIGN_OUT_SESSION, { token: counter.access, body: { session_id: phone.session_id } });

        assert.equal(res.status, 200);
        const ended = await h.session(phone.session_id);
        assert.equal(ended.status, "Revoked");
        assert.equal(ended.end_reason, "RemoteSignOut");
        const refused = await h.refresh(phone.refresh);
        assert.equal(refused.status, 401);
        assert.equal(refused.body.data.ended_reason, "RemoteSignOut", "the phone is told it was signed out from elsewhere");
        assert.equal((await me(phone.access)).status, 401, "the phone is refused on its very next request");
        assert.equal((await me(counter.access)).status, 200);

        const logged = await h.eventually(() => h.query("SELECT description FROM activity_log WHERE title = 'Signed out a device'"), (rows) => rows.length > 0);
        assert.match(logged[0]?.description ?? "", /Safari on iOS/);
    });

    it("will not end another account's session, and answers as if it did not exist", async () => {
        const colleague = await h.seed_user({ email: "rafi@samiha.test" });
        const theirs = await h.sign_in(colleague);

        const res = await h.call(h.ROUTE.SIGN_OUT_SESSION, { token: counter.access, body: { session_id: theirs.session_id } });

        assert.equal(res.status, 404);
        assert.equal((await h.session(theirs.session_id)).status, "Active");
    });

    it("sends this device's own session to Sign out instead", async () => {
        const res = await h.call(h.ROUTE.SIGN_OUT_SESSION, { token: counter.access, body: { session_id: counter.session_id } });

        assert.equal(res.status, 400);
        assert.equal((await h.session(counter.session_id)).status, "Active");
    });

    it("signs out every other device and keeps this one", async () => {
        const laptop = await h.sign_in(user);

        const res = await h.call(h.ROUTE.SIGN_OUT_EVERYWHERE, { token: counter.access, body: { keep_current: true } });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.sessions_closed, 2);
        assert.equal(res.set_cookie, null, "this device keeps its cookie");
        assert.equal((await h.session(counter.session_id)).status, "Active");
        for (const other of [phone, laptop]) assert.equal((await h.session(other.session_id)).status, "Revoked");
        assert.deepEqual((await sessions(counter.access)).body.data.map((s) => s.id), [counter.session_id]);
    });

    it("needs a signed-in caller", async () => {
        assert.equal((await sessions(null)).status, 401);
        assert.equal((await h.call(h.ROUTE.SIGN_OUT_SESSION, { body: { session_id: phone.session_id } })).status, 401);
    });
});
