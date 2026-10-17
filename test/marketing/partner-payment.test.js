const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const PAY = CONTEXTS.MARKETING + SUB_CONTEXTS.PARTNER_PAYMENT + ROUTES.CREATE_PARTNER_PAYMENT;
const CAMPAIGN = CONTEXTS.MARKETING + SUB_CONTEXTS.CAMPAIGN;
const PARTNER_DETAILS = CONTEXTS.MARKETING + SUB_CONTEXTS.PARTNER + ROUTES.GET_PARTNER_DETAILS;

const RUN = ["marketing.partner.view", "marketing.campaign.view", "marketing.campaign.create", "marketing.campaign.edit"];
const PAYER = [...RUN, "marketing.partner-payment.view", "marketing.partner-payment.create"];

before(h.start);
after(h.stop);

const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const get = (route, token) => h.call(route, { method: "GET", token });
const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `payer-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;

let batch, page, campaign, line;

// One campaign promoting one batch, with Style Diaries on it at a fee of 5,000.
const seed = async (token) => {
    const [category, sub_category, product] = [uuidv4(), uuidv4(), uuidv4()];
    [batch, page] = [uuidv4(), uuidv4()];
    await h.query("TRUNCATE inventory, product, sub_categories CASCADE");
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Dresses', 'DRES', $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, status) VALUES ($1, 'Floral dress', $2, $3, 'Active')", [product, category, sub_category]);
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, status) VALUES ($1, 'B-1', $2, 50, 30, 400, 'ready_for_sale')", [batch, product]);
    await h.query("INSERT INTO partner (oid, name, partner_type, status, payment_method) VALUES ($1, 'Style Diaries', 'Page', 'Active', 'bKash')", [page]);
    campaign = uuidv4();
    const made = await post(CAMPAIGN + ROUTES.CREATE_CAMPAIGN, token, { oid: campaign, name: "Winter dresses", promotion_type: "InfluencerPost", posting_start: "2026-11-02", posting_end: "2026-11-08", batches: [batch], partners: [{ partner_oid: page, agreed_fee: 5000 }] });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    line = (await h.query("SELECT oid FROM campaign_partner WHERE campaign_oid = $1", [campaign]))[0].oid;
};

const payment = (amount, extra = {}) => ({ oid: uuidv4(), campaign_partner_oid: line, amount, paid_on: "2026-11-03", payment_method: "bKash", reference: "TX-1", ...extra });
const details = async (token) => (await get(`${CAMPAIGN}${ROUTES.GET_CAMPAIGN_DETAILS}/${campaign}`, token)).body.data;

describe("payments to partners", () => {
    beforeEach(h.reset);

    it("refuses someone who may run campaigns but not record payments", async () => {
        const runner = await sign_in_with(RUN);
        await seed(runner);
        assert.equal((await post(PAY, runner, payment(2500))).status, 403);
    });

    it("records a payment in parts until nothing is owed, once for a repeated save, with a line in the activity", async () => {
        const token = await sign_in_with(PAYER);
        await seed(token);
        const half = payment(2500);
        const first = await post(PAY, token, half);
        assert.deepEqual([first.status, first.body.data.paid, first.body.data.owed], [200, 2500, 2500]);
        assert.equal((await post(PAY, token, half)).body.data.paid, 2500, "a repeated save is recorded once");

        assert.equal((await post(PAY, token, payment(2500, { paid_on: "2026-11-10" }))).body.data.owed, 0);
        const [partner] = (await details(token)).partners;
        assert.deepEqual([partner.paid, partner.owed, partner.payments.length], [5000, 0, 2]);
        assert.equal((await h.query("SELECT count(*)::int AS n FROM activity_log WHERE reference_oid = $1 AND title = 'Partner paid'", [campaign]))[0].n, 2);
    });

    it("shows nothing owed, not less than nothing, when a partner was paid more than the fee", async () => {
        const token = await sign_in_with(PAYER);
        await seed(token);
        const over = await post(PAY, token, payment(6000));
        assert.deepEqual([over.body.data.paid, over.body.data.owed], [6000, 0]);
    });

    it("leaves paid, owed and the payments out for someone who may not see payments", async () => {
        const payer = await sign_in_with(PAYER);
        await seed(payer);
        await post(PAY, payer, payment(1000));
        const runner = await sign_in_with(RUN);
        const seen = await details(runner);
        assert.equal(seen.payments_shown, false);
        assert.equal(seen.partners[0].paid, undefined);
        assert.equal(seen.partners[0].payments, undefined);
        assert.ok(!seen.activity.some((a) => (a.description ?? "").includes("1000")), "the activity names no amount");

        const partner = (await get(`${PARTNER_DETAILS}/${page}`, runner)).body.data;
        assert.deepEqual(partner.campaigns.map((c) => [c.campaign_no.slice(0, 3), Number(c.agreed_fee), c.owed]), [["CM-", 5000, undefined]]);
        assert.equal((await get(`${PARTNER_DETAILS}/${page}`, payer)).body.data.campaigns[0].owed, 4000);
    });

    it("will not take a paid partner off a campaign, and keeps the payment", async () => {
        const token = await sign_in_with(PAYER);
        await seed(token);
        await post(PAY, token, payment(1000));
        const edit = await post(CAMPAIGN + ROUTES.UPDATE_CAMPAIGN, token, { oid: campaign, name: "Winter dresses", promotion_type: "DiscountOffer", posting_start: "2026-11-02", posting_end: "2026-11-08", batches: [batch], partners: [] });
        assert.equal(edit.status, 409);
        assert.match(edit.body.message, /Style Diaries has payments/);
        assert.equal((await h.query("SELECT count(*)::int AS n FROM partner_payment"))[0].n, 1);
    });

    it("records no payment on a cancelled campaign", async () => {
        const token = await sign_in_with([...PAYER, "marketing.campaign.cancel"]);
        await seed(token);
        await post(CAMPAIGN + ROUTES.CANCEL_CAMPAIGN, token, { oid: campaign, note: "Partner backed out" });
        const refused = await post(PAY, token, payment(1000));
        assert.equal(refused.status, 409);
        assert.match(refused.body.message, /is cancelled/);
    });

    it("refuses a payment of nothing, and one for a partner no longer on the campaign", async () => {
        const token = await sign_in_with(PAYER);
        await seed(token);
        assert.equal((await post(PAY, token, payment(0))).status, 400);
        assert.equal((await post(PAY, token, payment(100, { campaign_partner_oid: uuidv4() }))).status, 404);
    });
});
