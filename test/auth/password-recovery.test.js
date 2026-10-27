const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, ROUTES } = require("../../src/utils/constant");

const FORGOT = CONTEXTS.AUTH + ROUTES.FORGOT_PASSWORD;

before(h.start);
after(h.stop);

// Each test asks from its own address, so the per-IP limit of one never meets another's.
const from = () => ({ "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
const forgot = (email, headers = from()) => h.call(FORGOT, { body: { email }, headers });
const codes = (email) => h.query("SELECT otp, status FROM otp_log WHERE user_id = $1 ORDER BY created_on", [email]);
const reset = (email, otp) => h.call(h.ROUTE.RESET_PASSWORD, { body: { email, otp, new_password: "NewPass-2026", confirm_password: "NewPass-2026" }, headers: from() });

describe("asking for a password reset code", () => {
    let user;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user();
    });

    it("sends one live code to a real address, never putting the code in the answer", async () => {
        const res = await forgot(user.email);

        assert.equal(res.status, 200);
        assert.equal(res.body.data.sent, true);
        assert.ok(new Date(res.body.data.expires_at) > new Date());
        const sent = await codes(user.email);
        assert.equal(sent.length, 1);
        assert.equal(sent[0].status, "Active");
        assert.equal(JSON.stringify(res.body).includes(sent[0].otp), false);
    });

    it("finds the account whatever the case of the address typed", async () => {
        assert.equal((await forgot(user.email.toUpperCase())).status, 200);
    });

    it("says plainly when no account has that address, and makes no code", async () => {
        const res = await forgot("nobody@arithmalabs.test");

        assert.equal(res.status, 404);
        assert.match(res.body.message, /No account found/);
        assert.equal((await h.query("SELECT count(*)::int AS n FROM otp_log"))[0].n, 0);
    });

    it("keeps only the newest code live, so an older one cannot still be guessed", async () => {
        const headers = from();
        await forgot(user.email, headers);
        await forgot(user.email, headers);

        assert.deepEqual((await codes(user.email)).map((c) => c.status), ["Inactive", "Active"]);
    });

    it("stops after three codes to one address in fifteen minutes, from any machine", async () => {
        for (let i = 0; i < 3; i++) assert.equal((await forgot(user.email)).status, 200);

        const fourth = await forgot(user.email);

        assert.equal(fourth.status, 429);
        assert.equal((await codes(user.email)).length, 3);
    });

    it("stops one machine walking a list of addresses after ten tries, before saying which exist", async () => {
        const headers = from();
        for (let i = 0; i < 10; i++) await forgot(`walker-${uuidv4().slice(0, 8)}@arithmalabs.test`, headers);

        const eleventh = await forgot(user.email, headers);

        assert.equal(eleventh.status, 429);
        assert.ok(Number(eleventh.retry_after) > 0);
        assert.equal((await codes(user.email)).length, 0);
    });
});

describe("resetting with a code", () => {
    let user;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user();
        await h.query("INSERT INTO otp_log (oid, user_id, otp, expires_at, status) VALUES ($1, $2, '123456', LOCALTIMESTAMP + interval '10 minutes', 'Active')", [uuidv4(), user.email]);
    });

    it("refuses the right code once five wrong ones were tried, so a code cannot be guessed", async () => {
        for (let i = 0; i < 5; i++) assert.notEqual((await reset(user.email, `00000${i}`)).status, 200);

        const right = await reset(user.email, "123456");

        assert.notEqual(right.status, 200);
        const [login] = await h.query("SELECT password FROM login WHERE oid = $1", [user.oid]);
        const bcrypt = require("bcrypt");
        assert.equal(await bcrypt.compare(user.password, login.password), true, "the old password still works");
    });
});
