const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const h = require("../support/harness");

before(h.start);
after(h.stop);

const me = (token) => h.call(h.ROUTE.ME, { method: "GET", token });

describe("refresh", () => {
    let user;
    let signed;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user();
        signed = await h.sign_in(user);
    });

    it("replaces the refresh token and issues an access token that works", async () => {
        const res = await h.refresh(signed.refresh);

        assert.equal(res.status, 200);
        assert.ok(res.cookie);
        assert.notEqual(res.cookie, signed.refresh);

        const old = await h.token_row(signed.refresh);
        const fresh = await h.token_row(res.cookie);
        assert.equal(old.status, "Rotated");
        assert.equal(old.replaced_by_oid, fresh.oid);
        assert.equal(fresh.status, "Active");

        assert.equal((await me(res.body.data.access_token)).status, 200);
        assert.equal((await h.events("TOKEN_REFRESH")).length, 1);
    });

    it("reissues an answer that never arrived, while its replacement is still unused", async () => {
        const lost = await h.refresh(signed.refresh);

        const retry = await h.refresh(signed.refresh);

        assert.equal(retry.status, 200);
        assert.notEqual(retry.cookie, lost.cookie);
        assert.equal((await h.session(signed.session_id)).status, "Active");
        assert.equal((await h.token_row(lost.cookie)).status, "Revoked");
        assert.equal((await h.refresh(retry.cookie)).status, 200);
    });

    it("ends the whole session when a replaced token comes back after its replacement was used", async () => {
        const first = await h.refresh(signed.refresh);
        const second = await h.refresh(first.cookie);

        const copy = await h.refresh(signed.refresh);

        assert.equal(copy.status, 401);
        assert.equal(copy.body.data.reason, "reuse");
        assert.equal(copy.body.data.ended_reason, "TokenReuse", "the device is told why");
        const session = await h.session(signed.session_id);
        assert.equal(session.status, "Revoked");
        assert.equal(session.end_reason, "TokenReuse");
        assert.equal((await h.refresh(second.cookie)).status, 401, "the owner's current token dies with it");
        assert.equal((await me(second.body.data.access_token)).status, 401);
        assert.equal((await h.events("REFRESH_TOKEN_REUSE")).length, 1);
    });

    it("treats a replaced token as a stolen copy once the grace window has passed", async () => {
        const first = await h.refresh(signed.refresh);
        await h.query("UPDATE auth_refresh_token SET rotated_on = rotated_on - interval '31 seconds' WHERE token_hash = $1", [h.hash(signed.refresh)]);

        const late = await h.refresh(signed.refresh);

        assert.equal(late.status, 401);
        assert.equal(late.body.data.reason, "reuse");
        assert.equal((await h.refresh(first.cookie)).status, 401);
    });

    it("renews exactly once when two renewals race with the same token", async () => {
        const results = await Promise.all([h.refresh(signed.refresh), h.refresh(signed.refresh)]);

        assert.deepEqual(results.map((r) => r.status), [200, 200]);
        const active = await h.query("SELECT oid FROM auth_refresh_token WHERE session_oid = $1 AND status = 'Active'", [signed.session_id]);
        assert.equal(active.length, 1);
        assert.equal((await h.session(signed.session_id)).status, "Active");
    });

    it("refuses an expired refresh token and closes the session", async () => {
        await h.query("UPDATE auth_refresh_token SET expires_on = LOCALTIMESTAMP - interval '1 minute'");

        const res = await h.refresh(signed.refresh);

        assert.equal(res.status, 401);
        assert.equal(res.body.data.reason, "expired");
        assert.equal(res.body.data.ended_reason, "Expired");
        assert.equal((await h.session(signed.session_id)).status, "Expired");

        const again = await h.refresh(signed.refresh);
        assert.equal(again.body.data.ended_reason, "Expired", "still told why when the ended session is presented again");
    });

    it("refuses once the 30 day cap has passed, however recently the session was used", async () => {
        await h.query("UPDATE auth_session SET expires_on = LOCALTIMESTAMP - interval '1 minute'");

        const res = await h.refresh(signed.refresh);

        assert.equal(res.status, 401);
        assert.equal(res.body.data.reason, "expired");
    });

    it("refuses a token it never issued", async () => {
        const res = await h.refresh("a-token-nobody-issued");

        assert.equal(res.status, 401);
        assert.equal(res.body.data.reason, "invalid");
        assert.equal(res.body.data.ended_reason, null, "a token nobody issued learns nothing");
        assert.equal((await h.events("REFRESH_REJECTED")).length, 1);
    });

    it("refuses a request that carries no refresh token", async () => {
        const res = await h.call(h.ROUTE.REFRESH);

        assert.equal(res.status, 401);
        assert.equal(res.body.data.reason, "missing");
    });

    /** A token a script could read is exactly what the cookie exists to prevent. */
    it("ignores a refresh token sent in the body under the cookie transport", async () => {
        const res = await h.call(h.ROUTE.REFRESH, { body: { refresh_token: signed.refresh } });

        assert.equal(res.status, 401);
        assert.equal(res.body.data.reason, "missing");
    });

    it("refuses and closes the session of an account that was turned off", async () => {
        await h.query("UPDATE login SET status = 'Inactive' WHERE oid = $1", [user.oid]);

        const res = await h.refresh(signed.refresh);

        assert.equal(res.status, 401);
        const session = await h.session(signed.session_id);
        assert.equal(session.status, "Revoked");
        assert.equal(session.end_reason, "UserDeactivated");
    });
});

describe("sign-out", () => {
    let user;
    let signed;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user();
        signed = await h.sign_in(user);
    });

    it("ends the session, so neither token works afterwards", async () => {
        const res = await h.call(h.ROUTE.SIGN_OUT, { cookie: signed.refresh, token: signed.access });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.sessions_closed, 1);
        assert.equal(res.cookie, "", "the cookie is cleared");

        assert.equal((await h.refresh(signed.refresh)).status, 401);
        assert.equal((await me(signed.access)).status, 401);

        const session = await h.session(signed.session_id);
        assert.equal(session.status, "SignedOut");
        assert.equal(session.end_reason, "SignOut");
        assert.equal((await h.events("LOGOUT")).length, 1);
    });

    /** The usual moment to sign out is coming back to a tab after the access token has lapsed. */
    it("still ends the session when all it has is an access token that already expired", async () => {
        const expired = h.sign_token({ sid: signed.session_id, exp: Math.floor(Date.now() / 1000) - 60 }, { subject: user.oid });

        const res = await h.call(h.ROUTE.SIGN_OUT, { token: expired });

        assert.equal(res.body.data.sessions_closed, 1);
        assert.equal((await h.session(signed.session_id)).status, "SignedOut");
    });

    it("answers 200 when there is nothing left to end", async () => {
        const res = await h.call(h.ROUTE.SIGN_OUT);

        assert.equal(res.status, 200);
        assert.equal(res.body.data.sessions_closed, 0);
    });

    it("ends only this session, not the person's others", async () => {
        const other = await h.sign_in(user);

        await h.call(h.ROUTE.SIGN_OUT, { cookie: signed.refresh });

        assert.equal((await h.session(other.session_id)).status, "Active");
        assert.equal((await me(other.access)).status, 200);
    });
});
