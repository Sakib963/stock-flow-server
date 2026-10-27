// Node reads and writes timestamps as UTC. Every connection in this file runs the database fourteen
// hours ahead of that, so anything that compares a database time with node's clock is caught out.
process.env.PGOPTIONS = "-c TimeZone=Pacific/Kiritimati";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { save_generated_otp } = require("../../src/utils/helper");
const { check_rate_limit } = require("../../src/middleware/rate-limit");

before(h.start);
after(h.stop);

describe("expiry is judged on the database's clock, wherever the server runs", () => {
    let user;

    beforeEach(async () => {
        await h.reset();
        user = await h.seed_user();
    });

    it("a reset code lasts fifteen minutes", async () => {
        const { otp_oid } = await save_generated_otp(user.email);
        const [code] = await h.query("SELECT EXTRACT(EPOCH FROM expires_at - LOCALTIMESTAMP)::int AS left FROM otp_log WHERE oid = $1", [otp_oid]);
        assert.ok(code.left > 14 * 60 && code.left <= 15 * 60, `${code.left} seconds left`);
    });

    it("a code still in date resets the password", async () => {
        await h.query("INSERT INTO otp_log (oid, user_id, otp, expires_at, status) VALUES ($1, $2, '123456', LOCALTIMESTAMP + interval '10 minutes', 'Active')", [uuidv4(), user.email]);
        const res = await h.call(h.ROUTE.RESET_PASSWORD, { body: { email: user.email, otp: "123456", new_password: "NewPass-2026", confirm_password: "NewPass-2026" } });
        assert.equal(res.status, 200, JSON.stringify(res.body));
    });

    it("a code past its time is refused", async () => {
        await h.query("INSERT INTO otp_log (oid, user_id, otp, expires_at, status) VALUES ($1, $2, '123456', LOCALTIMESTAMP - interval '1 minute', 'Active')", [uuidv4(), user.email]);
        const res = await h.call(h.ROUTE.RESET_PASSWORD, { body: { email: user.email, otp: "123456", new_password: "NewPass-2026", confirm_password: "NewPass-2026" } });
        assert.equal(res.status, 404);
    });

    it("a throttled caller is told to wait until the window frees, not one second", async () => {
        const limit = { bucket: "one-clock", identifier: uuidv4(), limit: 1, window_minutes: 10 };
        assert.equal((await check_rate_limit(limit)).allowed, true);
        const refused = await check_rate_limit(limit);
        assert.equal(refused.allowed, false);
        assert.ok(refused.retry_after_seconds > 9 * 60 && refused.retry_after_seconds <= 10 * 60, `${refused.retry_after_seconds} seconds`);
    });
});
