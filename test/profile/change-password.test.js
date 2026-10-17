const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

before(h.start);
after(h.stop);

describe("changing a password with the emailed code", () => {
    let user;
    let here;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user({ permissions: [] });
        here = await h.sign_in(user);
    });

    const issue_code = async (otp, expires = "LOCALTIMESTAMP + interval '10 minutes'") => {
        const oid = uuidv4();
        await h.query(`INSERT INTO otp_log (oid, user_id, otp, expires_at, status) VALUES ($1, $2, $3, ${expires}, 'Active')`, [oid, user.email, otp]);
        return oid;
    };
    const verify = (otp_oid, otp) => h.call(h.ROUTE.VERIFY_PASSWORD_CHANGE, { token: here.access, body: { otp, otp_oid, new_password: "NewPass-2026" } });
    const attempts = async (oid) => (await h.query("SELECT attempts FROM otp_log WHERE oid = $1", [oid]))[0].attempts;

    it("emails a code only for the right current password, and names the field when it is wrong", async () => {
        const ask = (current_password) => h.call(CONTEXTS.PROFILE + SUB_CONTEXTS.CHANGE_PASSWORD + ROUTES.CHANGE_PASSWORD, { token: here.access, body: { current_password, new_password: "NewPass-2026", confirm_password: "NewPass-2026" } });
        const wrong = await ask("not-my-password");
        assert.equal(wrong.status, 400);
        assert.equal(wrong.body.data.field, "current_password");
        const right = await ask(user.password);
        assert.equal(right.status, 200, JSON.stringify(right.body));
        const [code] = await h.query("SELECT status FROM otp_log WHERE oid = $1", [right.body.data.otp_oid]);
        assert.equal(code.status, "Active");
    });

    it("refuses the password in use now as the new one, at both steps", async () => {
        const ask = await h.call(CONTEXTS.PROFILE + SUB_CONTEXTS.CHANGE_PASSWORD + ROUTES.CHANGE_PASSWORD, { token: here.access, body: { current_password: user.password, new_password: user.password, confirm_password: user.password } });
        assert.equal(ask.status, 400);
        assert.equal(ask.body.data.field, "new_password");
        assert.equal((await h.query("SELECT count(*)::int AS n FROM otp_log WHERE user_id = $1", [user.email]))[0].n, 0, "no code was emailed");

        // Straight to the second step with a live code, as a hand-written request would.
        const otp_oid = await issue_code("654321");
        const set = await h.call(h.ROUTE.VERIFY_PASSWORD_CHANGE, { token: here.access, body: { otp: "654321", otp_oid, new_password: user.password } });
        assert.equal(set.status, 400);
        assert.equal(set.body.data.field, "new_password");
        assert.equal(await attempts(otp_oid), 0, "not counted as a wrong code");
        const [code] = await h.query("SELECT status FROM otp_log WHERE oid = $1", [otp_oid]);
        assert.equal(code.status, "Active", "the code is not spent");
    });

    it("holds a new password to a letter, a number and a special character", async () => {
        const ask = (new_password) => h.call(CONTEXTS.PROFILE + SUB_CONTEXTS.CHANGE_PASSWORD + ROUTES.CHANGE_PASSWORD, { token: here.access, body: { current_password: user.password, new_password, confirm_password: new_password } });
        assert.equal((await ask("NewPass2026")).status, 400, "no special character");
        assert.equal((await ask("NewPass-2026")).status, 200);
    });

    it("stops guessing the current password after five tries in fifteen minutes", async () => {
        await h.query("TRUNCATE request_throttle");
        const ask = (current_password) => h.call(CONTEXTS.PROFILE + SUB_CONTEXTS.CHANGE_PASSWORD + ROUTES.CHANGE_PASSWORD, { token: here.access, body: { current_password, new_password: "NewPass-2026", confirm_password: "NewPass-2026" } });
        for (let i = 0; i < 5; i++) assert.equal((await ask("guess-" + i)).status, 400);
        assert.equal((await ask(user.password)).status, 429, "even the right one waits");
    });

    it("needs no permission, and spends the code so it works only once", async () => {
        const otp_oid = await issue_code("654321");
        assert.equal((await verify(otp_oid, "654321")).status, 200);
        assert.equal((await verify(otp_oid, "654321")).status, 404, "a spent code is gone");
        const [row] = await h.query("SELECT title FROM activity_log WHERE reference_type = 'auth' AND reference_oid = $1", [user.email]);
        assert.equal(row.title, "Password changed");
    });

    it("counts only the devices the person could see as signed out, and still closes the stale ones", async () => {
        const phone = await h.sign_in(user);
        const stale = await h.sign_in(user);
        await h.query("UPDATE auth_refresh_token SET expires_on = LOCALTIMESTAMP - interval '1 minute' WHERE session_oid = $1", [stale.session_id]);

        const res = await verify(await issue_code("654321"), "654321");

        assert.equal(res.status, 200);
        assert.equal(res.body.data.sessions_closed, 1);
        for (const other of [phone, stale]) assert.equal((await h.session(other.session_id)).status, "Revoked");
        assert.equal((await h.session(here.session_id)).status, "Active");
    });

    it("counts a wrong code, and stops at five wrong guesses even when the sixth is right", async () => {
        const otp_oid = await issue_code("654321");
        const wrong = await verify(otp_oid, "111111");
        assert.equal(wrong.status, 400);
        assert.equal(await attempts(otp_oid), 1);
        for (let i = 0; i < 4; i++) await verify(otp_oid, "111111");
        assert.equal((await verify(otp_oid, "654321")).status, 429);
        assert.equal((await h.call(h.ROUTE.SIGN_IN, { body: { email: user.email, password: "NewPass-2026", remember: false } })).status, 401, "the password did not change");
    });

    it("refuses an expired code, and another person's", async () => {
        const old = await issue_code("654321", "LOCALTIMESTAMP - interval '1 minute'");
        assert.equal((await verify(old, "654321")).status, 404);
        const other = await h.seed_user({ email: "rafi@arithmalabs.test", permissions: [] });
        const theirs = uuidv4();
        await h.query("INSERT INTO otp_log (oid, user_id, otp, expires_at, status) VALUES ($1, $2, '222222', LOCALTIMESTAMP + interval '10 minutes', 'Active')", [theirs, other.email]);
        assert.equal((await verify(theirs, "222222")).status, 404);
    });

    it("lets only one of two presses at the same moment use the code", async () => {
        const otp_oid = await issue_code("654321");
        const results = await Promise.all([verify(otp_oid, "654321"), verify(otp_oid, "654321")]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 404]);
    });
});
