const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.MARKETING + SUB_CONTEXTS.CAMPAIGN;
const LIST = BASE + ROUTES.GET_CAMPAIGN_LIST;
const DETAILS = BASE + ROUTES.GET_CAMPAIGN_DETAILS;
const BATCHES = BASE + ROUTES.GET_BATCHES_FOR_CAMPAIGN;
const PARTNERS = BASE + ROUTES.GET_PARTNERS_FOR_CAMPAIGN;
const CREATE = BASE + ROUTES.CREATE_CAMPAIGN;
const UPDATE = BASE + ROUTES.UPDATE_CAMPAIGN;
const START = BASE + ROUTES.START_CAMPAIGN;
const COMPLETE = BASE + ROUTES.COMPLETE_CAMPAIGN;
const CANCEL = BASE + ROUTES.CANCEL_CAMPAIGN;

const ALL = ["marketing.campaign.view", "marketing.campaign.create", "marketing.campaign.edit", "marketing.campaign.cancel"];

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `marketer-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;

let batch, empty_batch, page, agency;

// One dress bought in a batch of 50 with marketing budgets of 100 influencer and 20 ad run per unit,
// a second batch already sold out, and two partners, one of them inactive.
const seed = async () => {
    const [category, sub_category, product, purchase, line] = [uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4()];
    [batch, empty_batch, page, agency] = [uuidv4(), uuidv4(), uuidv4(), uuidv4()];
    await h.query("TRUNCATE inventory, purchase_details, purchase, product, sub_categories, cost_budget CASCADE");
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Dresses', 'DRES', $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, status) VALUES ($1, 'Floral dress', $2, $3, 'Active')", [product, category, sub_category]);
    await h.query("INSERT INTO supplier (oid, name, phone_number, status) VALUES ($1, 'Mill', '01700000000', 'Active')", [purchase]);
    await h.query("INSERT INTO purchase (oid, supplier_oid, total_amount, paid_amount, payment_status, status) VALUES ($1, $1, 0, 0, 'unpaid', 'Verified')", [purchase]);
    await h.query("INSERT INTO purchase_details (oid, purchase_oid, product_oid, ordered_quantity, verified_quantity, ordered_unit_price) VALUES ($1, $2, $3, 50, 50, 400)", [line, purchase, product]);
    await h.query("INSERT INTO cost_budget (oid, purchase_details_oid, influencer_cost, ad_run_cost) VALUES ($1, $2, 100, 20)", [uuidv4(), line]);
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, purchase_details_oid, initial_quantity, quantity_available, cost_price, status) VALUES ($1, 'B-1', $2, $3, 50, 30, 400, 'ready_for_sale')", [batch, product, line]);
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, status) VALUES ($1, 'B-0', $2, 10, 0, 380, 'ready_for_sale')", [empty_batch, product]);
    await h.query("INSERT INTO partner (oid, name, partner_type, status) VALUES ($1, 'Style Diaries', 'Page', 'Active'), ($2, 'Ad House', 'Business', 'Inactive')", [page, agency]);
};

const plan = (extra = {}) => ({ oid: uuidv4(), name: "Winter dresses", promotion_type: "InfluencerPost", posting_start: "2026-11-02", posting_end: "2026-11-08", ad_spend: 3000, batches: [batch], partners: [{ partner_oid: page, agreed_fee: 5000 }], ...extra });

describe("campaigns", () => {
    beforeEach(async () => {
        await h.reset();
        await seed();
    });

    it("refuses someone who may see campaigns but not plan them, and someone who may not cancel", async () => {
        const viewer = await sign_in_with(["marketing.campaign.view"]);
        assert.equal((await post(CREATE, viewer, plan())).status, 403);
        assert.equal((await get(BATCHES, viewer)).status, 403);
        const planner = await sign_in_with(["marketing.campaign.view", "marketing.campaign.create", "marketing.campaign.edit"]);
        const { oid } = (await post(CREATE, planner, plan())).body.data;
        assert.equal((await post(CANCEL, planner, { oid, note: "Partner backed out" })).status, 403);
    });

    it("offers active partners and batches still on the shelf, with each batch's budgets per unit and its units", async () => {
        const token = await sign_in_with(ALL);
        const partners = (await get(PARTNERS, token)).body.data;
        assert.deepEqual(partners.map((p) => p.name), ["Style Diaries"]);

        const [product] = (await get(BATCHES, token, { search: "floral" })).body.data;
        assert.deepEqual(product.batches.map((b) => [b.batch_code, b.units, b.on_hand, b.influencer_cost, b.ad_run_cost]), [["B-1", 50, 30, 100, 20]]);
    });

    it("plans a campaign with a number, the measuring window 3 days past posting, and planned against agreed cost", async () => {
        const token = await sign_in_with(ALL);
        const body = plan();
        const created = await post(CREATE, token, body);
        assert.equal(created.status, 200, JSON.stringify(created.body));
        assert.match(created.body.data.campaign_no, /^CM-\d{4}-\d{4}$/);

        const { details, batches, partners, costs, activity } = (await h.call(`${DETAILS}/${body.oid}`, { method: "GET", token })).body.data;
        assert.deepEqual([details.status, details.measure_end], ["Planned", "2026-11-11"]);
        assert.equal(batches.length, 1);
        assert.deepEqual(partners.map((p) => [p.name, Number(p.agreed_fee)]), [["Style Diaries", 5000]]);
        // Planned: (100 + 20) per unit times the batch's 50 units. Agreed: 5,000 fee and 3,000 ad spend.
        assert.deepEqual([costs.planned.influencer_cost, costs.planned.ad_run_cost, costs.planned.total], [5000, 1000, 6000]);
        assert.deepEqual([costs.agreed.fees, costs.agreed.ad_spend, costs.agreed.other_cost, costs.agreed.total, costs.difference], [5000, 3000, null, 8000, 2000]);
        assert.equal(activity[0].action, "Campaign planned");
    });

    it("gives the same campaign back to a save repeated after a lost answer", async () => {
        const token = await sign_in_with(ALL);
        const body = plan();
        const first = await post(CREATE, token, body);
        const again = await post(CREATE, token, body);
        assert.equal(again.body.data.campaign_no, first.body.data.campaign_no);
        assert.equal((await h.query("SELECT count(*)::int AS n FROM campaign"))[0].n, 1);
    });

    it("refuses a posting window that ends before it starts, and a campaign with no batch", async () => {
        const token = await sign_in_with(ALL);
        assert.equal((await post(CREATE, token, plan({ posting_end: "2026-11-01" }))).status, 400);
        assert.equal((await post(CREATE, token, plan({ batches: [] }))).status, 400);
    });

    it("keeps a partner's row when only the fee changes, and drops a partner taken off", async () => {
        const token = await sign_in_with(ALL);
        const body = plan();
        await post(CREATE, token, body);
        const [before_row] = await h.query("SELECT oid FROM campaign_partner WHERE campaign_oid = $1", [body.oid]);

        await post(UPDATE, token, { ...body, partners: [{ partner_oid: page, agreed_fee: 7000 }] });
        const [after_row] = await h.query("SELECT oid, agreed_fee::int AS fee FROM campaign_partner WHERE campaign_oid = $1", [body.oid]);
        assert.deepEqual([after_row.oid, after_row.fee], [before_row.oid, 7000]);

        await post(UPDATE, token, { ...body, promotion_type: "DiscountOffer", partners: [] });
        assert.equal((await h.query("SELECT count(*)::int AS n FROM campaign_partner WHERE campaign_oid = $1", [body.oid]))[0].n, 0);
    });

    it("moves only by its buttons: Start, then Complete, and a completed campaign can no longer change", async () => {
        const token = await sign_in_with(ALL);
        const body = plan();
        await post(CREATE, token, body);

        assert.equal((await post(COMPLETE, token, { oid: body.oid })).status, 409, "a planned campaign cannot be completed");
        assert.equal((await post(START, token, { oid: body.oid })).body.data.status, "Live");
        assert.equal((await post(START, token, { oid: body.oid })).status, 409, "started once");
        assert.equal((await post(COMPLETE, token, { oid: body.oid })).body.data.status, "Completed");
        assert.equal((await post(UPDATE, token, body)).status, 409);
        assert.equal((await post(CANCEL, token, { oid: body.oid, note: "Too late" })).status, 409);
    });

    it("never adds an inactive partner, but keeps one already on the campaign", async () => {
        const token = await sign_in_with(ALL);
        const refused = await post(CREATE, token, plan({ partners: [{ partner_oid: agency, agreed_fee: 4000 }] }));
        assert.equal(refused.status, 409);
        assert.match(refused.body.message, /Ad House is inactive/);

        const body = plan();
        await post(CREATE, token, body);
        await h.query("UPDATE partner SET status = 'Inactive' WHERE oid = $1", [page]);
        assert.equal((await post(UPDATE, token, { ...body, name: "Winter dresses, week 2" })).status, 200);
    });

    it("works out the planned budget of a batch from a stock adjustment, and of a batch with no budget as nothing", async () => {
        const token = await sign_in_with(ALL);
        const [adjustment, line, adjusted] = [uuidv4(), uuidv4(), uuidv4()];
        await h.query("INSERT INTO stock_adjustment (oid, reason, status) VALUES ($1, 'opening_stock', 'Verified')", [adjustment]);
        await h.query("INSERT INTO stock_adjustment_line (oid, adjustment_oid, quantity) VALUES ($1, $2, 20)", [line, adjustment]);
        await h.query("INSERT INTO cost_budget (oid, stock_adjustment_line_oid, gift_cost, content_creation_cost) VALUES ($1, $2, 30, 10)", [uuidv4(), line]);
        await h.query("INSERT INTO inventory (oid, batch_code, product_oid, stock_adjustment_line_oid, initial_quantity, quantity_available, cost_price, status) SELECT $1, 'B-2', product_oid, $2, 20, 20, 400, 'ready_for_sale' FROM inventory WHERE oid = $3", [adjusted, line, batch]);

        const body = plan({ batches: [adjusted, empty_batch], partners: [] });
        await post(CREATE, token, body);
        const { batches, costs } = (await h.call(`${DETAILS}/${body.oid}`, { method: "GET", token })).body.data;
        assert.equal(batches.length, 2, "each batch once");
        // (30 + 10) per unit times 20 units; the batch with no budget adds nothing.
        assert.deepEqual([costs.planned.gift_cost, costs.planned.content_creation_cost, costs.planned.total], [600, 200, 800]);
    });

    it("never moves stock, holds or the ledger, whatever is done to a campaign", async () => {
        const token = await sign_in_with(ALL);
        const shelf = () => h.query("SELECT (SELECT json_agg(json_build_object('oid', oid, 'q', quantity_available) ORDER BY oid) FROM inventory) AS stock, (SELECT count(*)::int FROM stock_hold) AS holds, (SELECT count(*)::int FROM stock_movement) AS moves");
        const before = (await shelf())[0];
        const body = plan();
        await post(CREATE, token, body);
        await post(UPDATE, token, { ...body, partners: [] });
        await post(START, token, { oid: body.oid });
        await post(COMPLETE, token, { oid: body.oid });
        assert.deepEqual((await shelf())[0], before);
    });

    it("cancels a live campaign with its note, and lists campaigns by status with the counts", async () => {
        const token = await sign_in_with(ALL);
        const live = plan();
        await post(CREATE, token, live);
        await post(START, token, { oid: live.oid });
        await post(CREATE, token, plan({ name: "Eid looks" }));

        const cancelled = await post(CANCEL, token, { oid: live.oid, note: "Partner backed out" });
        assert.equal(cancelled.body.data.status, "Cancelled");
        assert.equal((await h.query("SELECT cancel_note FROM campaign WHERE oid = $1", [live.oid]))[0].cancel_note, "Partner backed out");

        const listed = (await get(LIST, token, { status: "Planned", include: "stats" })).body;
        assert.deepEqual(listed.data.rows.map((r) => [r.name, Number(r.agreed_cost)]), [["Eid looks", 8000]]);
        assert.deepEqual(listed.data.stats, { planned: 1, live: 0, completed: 0 });
    });
});

describe("the partners a campaign picks from, searched on the server", () => {
    let planner;

    beforeEach(async () => {
        await h.reset();
        await h.query("TRUNCATE partner CASCADE");
        planner = await sign_in_with(ALL);
    });

    const seed = async (name, { handle = null, status = "Active" } = {}) => {
        const oid = uuidv4();
        await h.query("INSERT INTO partner (oid, name, partner_type, handle, status) VALUES ($1, $2, 'Page', $3, $4)", [oid, name, handle, status]);
        return oid;
    };

    it("finds an active partner by name or handle, fifty at a time", async () => {
        for (let i = 0; i < 53; i++) await seed(`Page ${String(i).padStart(2, "0")}`);
        await seed("Style Diaries", { handle: "@stylediaries" });

        assert.equal((await get(PARTNERS, planner)).body.data.length, 50);
        assert.equal((await get(PARTNERS, planner, { offset: 50 })).body.data.length, 4);
        assert.deepEqual((await get(PARTNERS, planner, { search: "@stylediar" })).body.data.map((p) => p.name), ["Style Diaries"]);
    });

    it("names a partner made inactive since, but never offers it", async () => {
        const gone = await seed("Ad House", { status: "Inactive" });

        assert.deepEqual((await get(PARTNERS, planner, { search: "ad house" })).body.data, []);
        assert.deepEqual((await get(PARTNERS, planner, { oids: gone })).body.data.map((p) => p.name), ["Ad House"]);
    });
});

describe("adding a partner the campaign already has", () => {
    it("is never offered again, so a page is never emptied by partners already on the campaign", async () => {
        await h.reset();
        await h.query("TRUNCATE partner CASCADE");
        const planner = await sign_in_with(ALL);
        const [style, ad] = [uuidv4(), uuidv4()];
        await h.query("INSERT INTO partner (oid, name, partner_type, status) VALUES ($1, 'Style Diaries', 'Page', 'Active'), ($2, 'Ad House', 'Business', 'Active')", [style, ad]);

        const offered = (await get(PARTNERS, planner, { exclude: style })).body.data.map((p) => p.name);

        assert.deepEqual(offered, ["Ad House"]);
    });
});
