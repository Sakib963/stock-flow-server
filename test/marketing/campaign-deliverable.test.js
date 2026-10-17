const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const CAMPAIGN = CONTEXTS.MARKETING + SUB_CONTEXTS.CAMPAIGN;
const ADD = CAMPAIGN + ROUTES.CREATE_CAMPAIGN_DELIVERABLE;
const UPDATE = CAMPAIGN + ROUTES.UPDATE_CAMPAIGN_DELIVERABLE;
const REMOVE = CAMPAIGN + ROUTES.DELETE_CAMPAIGN_DELIVERABLE;

const RUN = ["marketing.campaign.view", "marketing.campaign.create", "marketing.campaign.edit", "marketing.campaign.cancel"];

before(h.start);
after(h.stop);

const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `poster-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;

let batch, page, campaign, line;

const seed = async (token) => {
    const [category, sub_category, product] = [uuidv4(), uuidv4(), uuidv4()];
    [batch, page, campaign] = [uuidv4(), uuidv4(), uuidv4()];
    await h.query("TRUNCATE inventory, product, sub_categories CASCADE");
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Dresses', 'DRES', $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, status) VALUES ($1, 'Floral dress', $2, $3, 'Active')", [product, category, sub_category]);
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, status) VALUES ($1, 'B-1', $2, 50, 30, 400, 'ready_for_sale')", [batch, product]);
    await h.query("INSERT INTO partner (oid, name, partner_type, status) VALUES ($1, 'Style Diaries', 'Page', 'Active')", [page]);
    await post(CAMPAIGN + ROUTES.CREATE_CAMPAIGN, token, { oid: campaign, name: "Winter dresses", promotion_type: "InfluencerPost", posting_start: "2026-11-02", posting_end: "2026-11-08", batches: [batch], partners: [{ partner_oid: page, agreed_fee: 5000 }] });
    line = (await h.query("SELECT oid FROM campaign_partner WHERE campaign_oid = $1", [campaign]))[0].oid;
};

const promise = (extra = {}) => ({ oid: uuidv4(), campaign_partner_oid: line, kind: "Reel", quantity: 1, due_on: "2026-11-05", ...extra });
const deliverables = async (token) => (await h.call(`${CAMPAIGN}${ROUTES.GET_CAMPAIGN_DETAILS}/${campaign}`, { method: "GET", token })).body.data.partners[0].deliverables;

describe("promised posts", () => {
    beforeEach(h.reset);

    it("refuses someone who may see campaigns but not run them", async () => {
        const token = await sign_in_with(RUN);
        await seed(token);
        const viewer = await sign_in_with(["marketing.campaign.view"]);
        assert.equal((await post(ADD, viewer, promise())).status, 403);
    });

    it("records a promise once, Pending, and hints when it is past due without changing it", async () => {
        const token = await sign_in_with(RUN);
        await seed(token);
        const reel = promise({ due_on: "2020-01-05" });
        assert.equal((await post(ADD, token, reel)).status, 200);
        assert.equal((await post(ADD, token, reel)).status, 200, "a repeated save");
        await post(ADD, token, promise({ kind: "Story", quantity: 2, due_on: "2099-01-01" }));

        const rows = await deliverables(token);
        assert.deepEqual(rows.map((d) => [d.kind, d.quantity, d.status, d.past_due]), [["Reel", 1, "Pending", true], ["Story", 2, "Pending", false]]);
    });

    it("marks a promise posted with its link and today, late with the day it went up, and missed with no day", async () => {
        const token = await sign_in_with(RUN);
        await seed(token);
        const reel = promise();
        await post(ADD, token, reel);

        const posted = await post(UPDATE, token, { ...reel, campaign_partner_oid: undefined, status: "Posted", link: "https://instagram.com/p/abc" });
        assert.equal(posted.status, 200, JSON.stringify(posted.body));
        let [row] = await deliverables(token);
        assert.equal(row.link, "https://instagram.com/p/abc");
        assert.ok(row.posted_on, "today is filled in");

        await post(UPDATE, token, { oid: reel.oid, kind: "Reel", due_on: "2026-11-05", status: "Late", posted_on: "2026-11-09", link: "https://instagram.com/p/abc" });
        [row] = await deliverables(token);
        assert.deepEqual([row.status, row.posted_on], ["Late", "2026-11-09"]);

        await post(UPDATE, token, { oid: reel.oid, kind: "Reel", due_on: "2026-11-05", status: "Missed", posted_on: "2026-11-09" });
        [row] = await deliverables(token);
        assert.deepEqual([row.status, row.posted_on, row.past_due], ["Missed", null, false]);
    });

    it("removes only a pending promise, and keeps the partner on the campaign while one is there", async () => {
        const token = await sign_in_with(RUN);
        await seed(token);
        const reel = promise();
        await post(ADD, token, reel);
        const edit = await post(CAMPAIGN + ROUTES.UPDATE_CAMPAIGN, token, { oid: campaign, name: "Winter dresses", promotion_type: "DiscountOffer", posting_start: "2026-11-02", posting_end: "2026-11-08", batches: [batch], partners: [] });
        assert.equal(edit.status, 409);

        await post(UPDATE, token, { oid: reel.oid, kind: "Reel", due_on: "2026-11-05", status: "Missed" });
        assert.equal((await post(REMOVE, token, { oid: reel.oid })).status, 409, "a promise with an outcome stays");
        const other = promise({ kind: "Live" });
        await post(ADD, token, other);
        assert.equal((await post(REMOVE, token, { oid: other.oid })).status, 200);
        assert.equal((await deliverables(token)).length, 1);
    });

    it("changes nothing on a cancelled campaign, and refuses a link that is not a web address", async () => {
        const token = await sign_in_with(RUN);
        await seed(token);
        assert.equal((await post(ADD, token, promise({ link: "not a link" }))).status, 400);
        await post(CAMPAIGN + ROUTES.CANCEL_CAMPAIGN, token, { oid: campaign, note: "Partner backed out" });
        const refused = await post(ADD, token, promise());
        assert.equal(refused.status, 409);
        assert.match(refused.body.message, /cancelled/);
    });
});
