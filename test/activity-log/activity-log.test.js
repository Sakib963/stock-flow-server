const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, ROUTES } = require("../../src/utils/constant");

const LIST = CONTEXTS.ACTIVITY_LOG + ROUTES.GET_ACTIVITY_LOG_LIST;
const SUMMARY = CONTEXTS.ACTIVITY_LOG + ROUTES.GET_ACTIVITY_LOG_SUMMARY;

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });

// One activity row, at a UTC wall-clock time, optionally with the request it was written in.
const entry = async ({ type, oid = uuidv4(), title, by = "owner@arithmalabs.test", at, device = null }) => {
    let request_id = null;
    if (device) {
        request_id = uuidv4();
        await h.query("INSERT INTO api_request_log (oid, method, route, path, status, duration_ms, device) VALUES ($1, 'POST', '/x', '/x', 200, 5, $2)", [request_id, JSON.stringify(device)]);
    }
    await h.query("INSERT INTO activity_log (oid, reference_oid, reference_type, title, description, performed_by, performed_on, request_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [uuidv4(), oid, type, title, `${title}, in detail`, by, at, request_id]);
};

describe("the activity log", () => {
    let owner;
    let brand;
    beforeEach(async () => {
        await h.reset();
        await h.query("TRUNCATE activity_log, api_request_log CASCADE");
        await h.query("UPDATE settings SET time_zone = 'Asia/Dhaka'");
        owner = (await h.sign_in(await h.seed_user({ email: "owner@arithmalabs.test", permissions: ["activity-log.activity-log.view"] }))).access;
        await h.seed_user({ email: "rafi@arithmalabs.test" });
        brand = uuidv4();
        await h.query("INSERT INTO brands (oid, name, status) VALUES ($1, 'Glow', 'Active')", [brand]);
        // Asia/Dhaka is UTC+6.
        await entry({ type: "brand", oid: brand, title: "Created brand", at: "2026-10-10 03:00:00", device: { browser: "Chrome", os: "Windows", type: "desktop" } });
        await entry({ type: "order", title: "Online order cancelled", by: "rafi@arithmalabs.test", at: "2026-10-11 05:00:00" });
        await entry({ type: "product-dispose", title: "Submitted", at: "2026-10-11 05:30:00" });
        await entry({ type: "product-dispose", title: "Dispose Approved", at: "2026-10-11 06:00:00" });
        await entry({ type: "product", title: "Deleted product", at: "2026-10-11 06:30:00" });
    });

    it("reads newest first with the person's name, the area, the device and whether the record can still be opened", async () => {
        const res = await get(LIST, owner);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const rows = res.body.data.rows;
        assert.deepEqual(rows.map((row) => row.title), ["Deleted product", "Dispose Approved", "Submitted", "Online order cancelled", "Created brand"]);
        const created = rows.at(-1);
        assert.deepEqual([created.performed_by_name, created.area, created.record_exists], ["Samiha Rahman", "configuration", true]);
        assert.deepEqual(created.device, { browser: "Chrome", os: "Windows", type: "desktop" });
        assert.equal(rows[0].record_exists, false, "a deleted product is not offered as a link");
        assert.equal(rows[0].device, null);
    });

    it("pages by number, with the total of every page for the pager", async () => {
        const first = await get(LIST, owner, { limit: 2 });
        assert.equal(first.body.data.rows.length, 2);
        const total = first.body.total;
        assert.ok(total > 2);
        const last = await get(LIST, owner, { limit: 2, offset: Math.floor((total - 1) / 2) * 2 });
        assert.equal(last.body.data.rows.length, total % 2 || 2);
        assert.equal(last.body.total, total);
    });

    it("flags only the moments that change money or stock: a disposal approved, not its draft", async () => {
        const rows = (await get(LIST, owner, { attention: "true" })).body.data.rows;
        assert.deepEqual(rows.map((row) => row.title).sort(), ["Deleted product", "Dispose Approved", "Online order cancelled"]);
        assert.ok(rows.every((row) => row.attention));
    });

    it("narrows by person, area, business days and a search over the name", async () => {
        assert.deepEqual((await get(LIST, owner, { person: "rafi@arithmalabs.test" })).body.data.rows.map((row) => row.title), ["Online order cancelled"]);
        assert.deepEqual((await get(LIST, owner, { area: "inventory" })).body.data.rows.map((row) => row.title), ["Dispose Approved", "Submitted"]);
        // 2026-10-10 03:00 UTC is 09:00 on the 10th in Dhaka; the rest are on the 11th.
        assert.deepEqual((await get(LIST, owner, { date_from: "2026-10-10", date_to: "2026-10-10" })).body.data.rows.map((row) => row.title), ["Created brand"]);
        assert.deepEqual((await get(LIST, owner, { search: "rafi" })).body.data.rows.map((row) => row.title), ["Online order cancelled"]);
        assert.deepEqual((await get(LIST, owner, { search: "brand" })).body.data.rows.map((row) => row.title), ["Created brand"]);
        assert.equal((await get(LIST, owner, { area: "nowhere" })).status, 400);
        assert.equal((await get(LIST, owner, { date_from: "2026-02-30" })).status, 400);
    });

    it("sums up exactly the rows the feed shows: actions, worth a look, people, the busiest hour and the week", async () => {
        const res = await get(SUMMARY, owner, { date_from: "2026-10-11", date_to: "2026-10-11" });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const s = res.body.data;
        assert.deepEqual([s.actions, s.attention, s.people_count], [4, 3, 2]);
        assert.deepEqual(s.people.map((p) => [p.email, p.actions]), [
            ["owner@arithmalabs.test", 3],
            ["rafi@arithmalabs.test", 1],
        ]);
        // 05:00 to 06:30 UTC on Sunday the 11th is 11:00 to 12:30 in Dhaka: two in each hour, the earlier wins the tie.
        assert.equal(s.busiest_hour, 11);
        assert.deepEqual(s.week.sort((x, y) => x.hour - y.hour), [
            { day: 7, hour: 11, actions: 2 },
            { day: 7, hour: 12, actions: 2 },
        ]);
        assert.deepEqual(s.areas.map((x) => [x.area, x.actions]).sort(), [
            ["configuration", 1],
            ["inventory", 2],
            ["sales", 1],
        ]);
    });

    it("is closed without the permission, and without a sign in", async () => {
        const staff = (await h.sign_in(await h.seed_user({ email: "staff@arithmalabs.test", permissions: [] }))).access;
        assert.equal((await get(LIST, staff)).status, 403);
        assert.equal((await get(SUMMARY, staff)).status, 403);
        assert.equal((await get(LIST, null)).status, 401);
    });
});
