const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");

before(h.start);
after(h.stop);

const me = (token) => h.call(h.ROUTE.ME, { method: "GET", token });

describe("sign out everywhere", () => {
    let user;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user();
    });

    it("ends every session of the account, this one included", async () => {
        const counter = await h.sign_in(user);
        const phone = await h.sign_in(user);
        const laptop = await h.sign_in(user);

        const res = await h.call(h.ROUTE.SIGN_OUT_EVERYWHERE, { token: counter.access });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.sessions_closed, 3);
        for (const device of [counter, phone, laptop]) {
            const session = await h.session(device.session_id);
            assert.equal(session.status, "Revoked");
            assert.equal(session.end_reason, "SignOutEverywhere");
            const refused = await h.refresh(device.refresh);
            assert.equal(refused.status, 401);
            assert.equal(refused.body.data.ended_reason, "SignOutEverywhere");
        }
        assert.equal((await h.events("SESSION_REVOKED")).length, 3);

        const logged = await h.eventually(() => h.query("SELECT title FROM activity_log WHERE reference_oid = $1", [user.oid]), (rows) => rows.length > 0);
        assert.equal(logged[0]?.title, "Signed out everywhere");
    });

    it("leaves other accounts alone", async () => {
        const colleague = await h.seed_user({ email: "rafi@samiha.test" });
        const theirs = await h.sign_in(colleague);
        const mine = await h.sign_in(user);

        await h.call(h.ROUTE.SIGN_OUT_EVERYWHERE, { token: mine.access });

        assert.equal((await me(theirs.access)).status, 200);
    });

    it("needs a signed-in caller", async () => {
        assert.equal((await h.call(h.ROUTE.SIGN_OUT_EVERYWHERE)).status, 401);
    });
});

describe("password events", () => {
    let user;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user();
    });

    const issue_code = async (otp) => {
        const oid = uuidv4();
        await h.query("INSERT INTO otp_log (oid, user_id, otp, expires_at, status) VALUES ($1, $2, $3, LOCALTIMESTAMP + interval '10 minutes', 'Active')", [oid, user.email, otp]);
        return oid;
    };

    /** Recovery is the path someone takes after a takeover, so the intruder's session must not survive it. */
    it("a password reset ends every session the account has", async () => {
        const first = await h.sign_in(user);
        const second = await h.sign_in(user);
        await issue_code("123456");

        const res = await h.call(h.ROUTE.RESET_PASSWORD, { body: { email: user.email, otp: "123456", new_password: "NewPass2026", confirm_password: "NewPass2026" } });

        assert.equal(res.status, 200, JSON.stringify(res.body));
        for (const device of [first, second]) {
            const session = await h.session(device.session_id);
            assert.equal(session.status, "Revoked");
            assert.equal(session.end_reason, "PasswordReset");
        }
        const refused = await h.refresh(second.refresh);
        assert.equal(refused.status, 401);
        assert.equal(refused.body.data.ended_reason, "PasswordReset");
    });

    it("a password change ends every other session and keeps the one that made it", async () => {
        const here = await h.sign_in(user);
        const elsewhere = await h.sign_in(user);
        const otp_oid = await issue_code("654321");

        const res = await h.call(h.ROUTE.VERIFY_PASSWORD_CHANGE, { token: here.access, body: { otp: "654321", otp_oid, new_password: "NewPass2026" } });

        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.sessions_closed, 1);
        assert.equal((await h.session(here.session_id)).status, "Active");
        assert.equal((await me(here.access)).status, 200);

        const ended = await h.session(elsewhere.session_id);
        assert.equal(ended.status, "Revoked");
        assert.equal(ended.end_reason, "PasswordChanged");
    });
});

describe("turning an account off", () => {
    it("ends every session the account already has open", async () => {
        await h.reset();
        const admin = await h.seed_user({ email: "admin@samiha.test", permissions: ["administration.user.edit"] });
        const staff = await h.seed_user({ email: "rafi@samiha.test" });
        const counter = await h.sign_in(staff);
        const phone = await h.sign_in(staff);
        const signed_admin = await h.sign_in(admin);

        const res = await h.call(h.ROUTE.UPDATE_USER, {
            token: signed_admin.access,
            body: { oid: staff.oid, name: "Rafi Ahmed", email: staff.email, mobile_number: "01700000000", role: "Salesman", designation: null, photo: null, status: "Inactive" },
        });

        assert.equal(res.status, 200, JSON.stringify(res.body));
        for (const device of [counter, phone]) {
            const session = await h.session(device.session_id);
            assert.equal(session.status, "Revoked");
            assert.equal(session.end_reason, "UserDeactivated");
            const refused = await h.refresh(device.refresh);
            assert.equal(refused.status, 401);
            assert.equal(refused.body.data.ended_reason, "UserDeactivated");
        }
        assert.equal((await me(signed_admin.access)).status, 200, "the admin is not signed out by it");
    });
});

describe("audit trail", () => {
    it("records the lifecycle without ever holding a token", async () => {
        await h.reset();
        const user = await h.seed_user();
        await h.call(h.ROUTE.SIGN_IN, { body: { email: user.email, password: "Wrong-password-1" } });
        const signed = await h.sign_in(user);
        const renewed = await h.refresh(signed.refresh);
        await h.call(h.ROUTE.SIGN_OUT, { cookie: renewed.cookie, token: renewed.body.data.access_token });

        const rows = (await h.query("SELECT row_to_json(e)::text AS row FROM auth_event e")).map((r) => r.row);
        const types = (await h.query("SELECT event_type FROM auth_event ORDER BY created_on")).map((r) => r.event_type);

        assert.deepEqual(types, ["LOGIN_FAILED", "LOGIN_SUCCESS", "TOKEN_REFRESH", "LOGOUT"]);
        for (const secret of [signed.access, signed.refresh, renewed.cookie, renewed.body.data.access_token]) {
            assert.ok(!rows.some((row) => row.includes(secret)), "an auth event contains a token");
        }
    });
});
