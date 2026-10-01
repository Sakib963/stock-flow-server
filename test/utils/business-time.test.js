const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const h = require("../support/harness");
const { business_day, business_day_start, business_today, format_business, zone_label } = require("../../src/utils/business-time");

before(h.start);
after(h.stop);

const zone = (name) => h.query("UPDATE settings SET time_zone = $1", [name]);
const one = async (sql) => Object.values((await h.query(`SELECT ${sql} AS v`))[0])[0];

describe("business time", () => {
    it("reads a stored time as UTC whatever zone the server machine runs in", async () => {
        const [row] = await h.query("SELECT '2026-10-01 04:18:00'::timestamp AS at, '2026-10-15'::date AS day");
        assert.equal(row.at.toISOString(), "2026-10-01T04:18:00.000Z");
        assert.equal(row.day, "2026-10-15", "a calendar day stays the day it is");
    });

    it("shows one moment as the same business time to partners in Dhaka, New York and Los Angeles", () => {
        const sale = new Date("2026-10-01T04:18:00Z");
        assert.equal(format_business(sale, "Asia/Dhaka"), "2026-10-01 10:18");
        assert.equal(format_business(sale, "America/New_York"), "2026-10-01 00:18");
        assert.equal(format_business(sale, "America/Los_Angeles"), "2026-09-30 21:18");
        assert.equal(format_business("2026-10-15", "America/Los_Angeles", { time: false }), "2026-10-15", "a calendar day is never shifted");
        assert.match(zone_label("Asia/Dhaka"), /^Times in Asia\/Dhaka \(GMT\+6\)$/);
    });

    it("cuts the business day at the business's midnight, not UTC's", async () => {
        await h.query("INSERT INTO settings (oid, name) SELECT gen_random_uuid()::text, 'Test' WHERE NOT EXISTS (SELECT 1 FROM settings)");
        await zone("Asia/Dhaka");
        assert.equal(await one(`to_char(${business_day("'2026-09-30 17:59'::timestamp")}, 'YYYY-MM-DD')`), "2026-09-30", "11:59 pm in Dhaka is still the 30th");
        assert.equal(await one(`to_char(${business_day("'2026-09-30 18:00'::timestamp")}, 'YYYY-MM-DD')`), "2026-10-01", "midnight in Dhaka is the 1st");
        assert.equal((await one(business_day_start("'2026-10-01'"))).toISOString(), "2026-09-30T18:00:00.000Z");

        await zone("America/New_York");
        assert.equal(await one(`to_char(${business_day("'2026-10-01 03:00'::timestamp")}, 'YYYY-MM-DD')`), "2026-09-30", "11 pm the evening before in New York");
        assert.equal((await one(business_day_start("'2026-10-01'"))).toISOString(), "2026-10-01T04:00:00.000Z", "daylight saving: New York is UTC-4 in October");
        assert.equal(await one(`${business_today} = (now() AT TIME ZONE 'America/New_York')::date`), true);
        await zone("Asia/Dhaka");
    });

    it("refuses a time zone the database does not know", async () => {
        await assert.rejects(zone("Mars/Olympus"));
    });
});
