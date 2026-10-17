const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.MARKETING + SUB_CONTEXTS.PARTNER;
const LIST = BASE + ROUTES.GET_PARTNER_LIST;
const CREATE = BASE + ROUTES.CREATE_PARTNER;
const UPDATE = BASE + ROUTES.UPDATE_PARTNER_DETAILS;
const DETAILS = BASE + ROUTES.GET_PARTNER_DETAILS;
const AVAILABILITY = BASE + ROUTES.CHECK_PARTNER_AVAILABILITY;

const WRITER = ["marketing.partner.view", "marketing.partner.create", "marketing.partner.edit"];

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `marketer-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;

const PAGE = { name: "Style Diaries", partner_type: "Page", platforms: ["Facebook", "Instagram"], handle: "@stylediaries", phone_number: "01711-000000", payment_method: "bKash", payment_account: "01711000000", note: "", status: "Active" };

describe("partners", () => {
    beforeEach(h.reset);

    it("refuses someone who may see partners but not add them, and someone with no marketing access at all", async () => {
        const viewer = await sign_in_with(["marketing.partner.view"]);
        assert.equal((await post(CREATE, viewer, PAGE)).status, 403);
        const outsider = await sign_in_with(["sales.order.view"]);
        assert.equal((await get(LIST, outsider)).status, 403);
    });

    it("adds a partner with its platforms and payment details, and records who did it", async () => {
        const token = await sign_in_with(WRITER);
        const created = await post(CREATE, token, PAGE);
        assert.equal(created.status, 200, JSON.stringify(created.body));

        const { details, activity } = (await h.call(`${DETAILS}/${created.body.data.oid}`, { method: "GET", token })).body.data;
        assert.deepEqual([details.name, details.partner_type, details.platforms, details.payment_method, details.note], ["Style Diaries", "Page", ["Facebook", "Instagram"], "bKash", null]);
        assert.equal(activity[0].action, "Created partner");
    });

    it("refuses a second partner with the same name in any case, and says the name is taken as it is typed", async () => {
        const token = await sign_in_with(WRITER);
        const first = await post(CREATE, token, PAGE);
        const again = await post(CREATE, token, { ...PAGE, name: "  style diaries " });
        assert.deepEqual([again.status, again.body.data.field], [409, "name"]);

        assert.equal((await get(AVAILABILITY, token, { value: "STYLE DIARIES" })).body.data.available, false);
        assert.equal((await get(AVAILABILITY, token, { value: "Style Diaries", oid: first.body.data.oid })).body.data.available, true, "its own name is not taken");
    });

    it("saves a change, writes nothing when nothing changed, and refuses a platform it does not know", async () => {
        const token = await sign_in_with(WRITER);
        const { oid } = (await post(CREATE, token, PAGE)).body.data;

        const same = await post(UPDATE, token, { oid, ...PAGE });
        assert.equal(same.body.data.changed, false);

        const changed = await post(UPDATE, token, { oid, ...PAGE, platforms: ["TikTok"], status: "Inactive" });
        assert.equal(changed.body.data.changed, true);
        const rows = await h.query("SELECT platforms, status FROM partner WHERE oid = $1", [oid]);
        assert.deepEqual([rows[0].platforms, rows[0].status], [["TikTok"], "Inactive"]);
        assert.equal((await h.query("SELECT count(*)::int AS n FROM activity_log WHERE reference_oid = $1", [oid]))[0].n, 2);

        assert.equal((await post(UPDATE, token, { oid, ...PAGE, platforms: ["Snapchat"] })).status, 400);
    });

    it("lists partners filtered by type and status, with the counts for the stat strip", async () => {
        const token = await sign_in_with(WRITER);
        await post(CREATE, token, PAGE);
        await post(CREATE, token, { ...PAGE, name: "Ad House", partner_type: "Business", status: "Inactive" });

        const pages = (await get(LIST, token, { partner_type: "Page", include: "stats" })).body;
        assert.deepEqual(pages.data.rows.map((r) => r.name), ["Style Diaries"]);
        assert.deepEqual(pages.data.stats, { active: 1, inactive: 0 });
        assert.equal((await get(LIST, token, { status: "Inactive" })).body.total, 1);
    });

    it("answers 404 for a partner that does not exist", async () => {
        const token = await sign_in_with(WRITER);
        assert.equal((await h.call(`${DETAILS}/${uuidv4()}`, { method: "GET", token })).status, 404);
        assert.equal((await post(UPDATE, token, { oid: uuidv4(), ...PAGE })).status, 404);
    });
});
