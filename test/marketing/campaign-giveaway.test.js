const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const CAMPAIGN = CONTEXTS.MARKETING + SUB_CONTEXTS.CAMPAIGN;
const GIVEAWAY = CONTEXTS.SALES + SUB_CONTEXTS.GIVEAWAY;

const RUN = ["marketing.campaign.view", "marketing.campaign.create", "marketing.campaign.edit", "sales.giveaway.view", "sales.giveaway.create", "sales.giveaway.confirm"];
const WITH_MONEY = [...RUN, "inventory.stock-value.view"];

before(h.start);
after(h.stop);

const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `gifter-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;

let batch, page, campaign, line;

// A batch of 50 dresses at a cost of 400, with a gift budget of 10 per unit: 500 for the batch.
const seed = async (token) => {
    const [category, sub_category, product, purchase, purchase_line] = [uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4()];
    [batch, page, campaign] = [uuidv4(), uuidv4(), uuidv4()];
    await h.query("TRUNCATE giveaway, inventory, purchase_details, purchase, product, sub_categories, cost_budget, stock_movement CASCADE");
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Dresses', 'DRES', $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, status) VALUES ($1, 'Floral dress', $2, $3, 'Active')", [product, category, sub_category]);
    await h.query("INSERT INTO supplier (oid, name, phone_number, status) VALUES ($1, 'Mill', '01700000000', 'Active')", [purchase]);
    await h.query("INSERT INTO purchase (oid, supplier_oid, total_amount, paid_amount, payment_status, status) VALUES ($1, $1, 0, 0, 'unpaid', 'Verified')", [purchase]);
    await h.query("INSERT INTO purchase_details (oid, purchase_oid, product_oid, ordered_quantity, verified_quantity, ordered_unit_price) VALUES ($1, $2, $3, 50, 50, 400)", [purchase_line, purchase, product]);
    await h.query("INSERT INTO cost_budget (oid, purchase_details_oid, gift_cost) VALUES ($1, $2, 10)", [uuidv4(), purchase_line]);
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, purchase_details_oid, initial_quantity, quantity_available, cost_price, selling_price, status, intended_use) VALUES ($1, 'B-1', $2, $3, 50, 50, 400, 1500, 'ready_for_sale', 'for_sale')", [batch, product, purchase_line]);
    await h.query("INSERT INTO stock_movement (oid, inventory_oid, product_oid, reason, quantity, balance_after) VALUES ($1, $2, $3, 'received', 50, 50)", [uuidv4(), batch, product]);
    await h.query("INSERT INTO partner (oid, name, partner_type, status) VALUES ($1, 'Style Diaries', 'Page', 'Active')", [page]);
    const made = await post(CAMPAIGN + ROUTES.CREATE_CAMPAIGN, token, { oid: campaign, name: "Winter dresses", promotion_type: "Seeding", posting_start: "2026-11-02", posting_end: "2026-11-08", batches: [batch], partners: [{ partner_oid: page, agreed_fee: 0 }] });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    line = (await h.query("SELECT oid FROM campaign_partner WHERE campaign_oid = $1", [campaign]))[0].oid;
};

const gift = (quantity, extra = {}) => ({ oid: uuidv4(), recipient_name: "Style Diaries", note: "Seeding for the winter campaign", campaign_partner_oid: line, lines: [{ inventory_oid: batch, quantity }], ...extra });
const details = async (token) => (await h.call(`${CAMPAIGN}${ROUTES.GET_CAMPAIGN_DETAILS}/${campaign}`, { method: "GET", token })).body.data;

describe("products given for a campaign", () => {
    beforeEach(h.reset);

    it("counts a gift at cost once it is given, and tips that the gift budget is passed", async () => {
        const token = await sign_in_with(WITH_MONEY);
        await seed(token);
        const draft = gift(2);
        assert.equal((await post(GIVEAWAY + ROUTES.CREATE_GIVEAWAY, token, draft)).status, 200);
        assert.equal((await details(token)).costs.agreed.products, 0, "a draft is not yet given");

        const given = await post(GIVEAWAY + ROUTES.GIVE_GIVEAWAY, token, { oid: draft.oid });
        assert.equal(given.status, 200, JSON.stringify(given.body));
        const { costs, partners } = await details(token);
        // 2 dresses at 400 against a gift budget of 10 per unit for 50 units.
        assert.deepEqual([costs.agreed.products, costs.agreed.total, costs.planned.gift_cost], [800, 800, 500]);
        assert.deepEqual(costs.over.map((o) => [o.kind, o.over, o.batch_code]), [["gift_cost", 300, "B-1"]]);
        assert.deepEqual(partners[0].giveaways.map((g) => [g.status, g.units, Number(g.cost)]), [["Given", 2, 800]]);
        assert.equal((await h.query("SELECT quantity_available::int AS q FROM inventory WHERE oid = $1", [batch]))[0].q, 48, "the stock left through the giveaway");
        const moves = await h.query("SELECT reason, quantity::int AS quantity, balance_after::int AS balance FROM stock_movement WHERE inventory_oid = $1 ORDER BY created_on", [batch]);
        assert.deepEqual(moves.at(-1), { reason: "given_away", quantity: -2, balance: 48 });
        assert.equal(moves.reduce((sum, m) => sum + m.quantity, 0), 48, "the batch still adds up");
        const listed = (await h.call(`${CAMPAIGN}${ROUTES.GET_CAMPAIGN_LIST}`, { method: "GET", token })).body.data.rows;
        assert.equal(Number(listed[0].agreed_cost), 800, "the list agrees with the record");
    });

    it("leaves the cost of products given out for someone who may not see buying prices", async () => {
        const token = await sign_in_with(RUN);
        await seed(token);
        const draft = gift(1);
        await post(GIVEAWAY + ROUTES.CREATE_GIVEAWAY, token, draft);
        await post(GIVEAWAY + ROUTES.GIVE_GIVEAWAY, token, { oid: draft.oid });
        const { costs, partners } = await details(token);
        assert.equal(costs.agreed.products, null);
        assert.deepEqual(costs.over, []);
        assert.equal(partners[0].giveaways[0].cost, undefined);
    });

    it("will not give a draft made while the campaign ran once it is completed, and moves no stock", async () => {
        const token = await sign_in_with(WITH_MONEY);
        await seed(token);
        const draft = gift(1);
        await post(GIVEAWAY + ROUTES.CREATE_GIVEAWAY, token, draft);
        await post(CAMPAIGN + ROUTES.START_CAMPAIGN, token, { oid: campaign });
        await post(CAMPAIGN + ROUTES.COMPLETE_CAMPAIGN, token, { oid: campaign });
        const refused = await post(GIVEAWAY + ROUTES.GIVE_GIVEAWAY, token, { oid: draft.oid });
        assert.equal(refused.status, 409);
        assert.equal((await h.query("SELECT quantity_available::int AS q FROM inventory WHERE oid = $1", [batch]))[0].q, 50);
        assert.equal((await h.query("SELECT status FROM giveaway WHERE oid = $1", [draft.oid]))[0].status, "Draft");
    });

    it("keeps a partner with a gift on the campaign, and gives nothing more for a completed one", async () => {
        const token = await sign_in_with(WITH_MONEY);
        await seed(token);
        await post(GIVEAWAY + ROUTES.CREATE_GIVEAWAY, token, gift(1));
        const edit = await post(CAMPAIGN + ROUTES.UPDATE_CAMPAIGN, token, { oid: campaign, name: "Winter dresses", promotion_type: "DiscountOffer", posting_start: "2026-11-02", posting_end: "2026-11-08", batches: [batch], partners: [] });
        assert.equal(edit.status, 409);

        await post(CAMPAIGN + ROUTES.START_CAMPAIGN, token, { oid: campaign });
        await post(CAMPAIGN + ROUTES.COMPLETE_CAMPAIGN, token, { oid: campaign });
        const late = await post(GIVEAWAY + ROUTES.CREATE_GIVEAWAY, token, gift(1));
        assert.equal(late.status, 409);
        assert.match(late.body.message, /completed/);
    });
});
