const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.MARKETING + SUB_CONTEXTS.ANALYTICS;
const OVERVIEW = BASE + ROUTES.GET_MARKETING_ANALYTICS_OVERVIEW;
const RESULTS = BASE + ROUTES.GET_MARKETING_CAMPAIGN_RESULTS;
const COMPARISONS = BASE + ROUTES.GET_MARKETING_COMPARISONS;
const SOURCES = BASE + ROUTES.GET_MARKETING_SOURCES;
const NEXT = BASE + ROUTES.GET_MARKETING_NEXT;
const OWNER = ["marketing.analytics.view", "sales.pos.view", "sales.online.view"];
const MONEY = [...OWNER, "inventory.stock-value.view"];

before(h.start);
after(h.stop);

const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `analyst-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;
const get = (route, token, query = "date_from=2026-09-01&date_to=2026-09-30") => h.call(`${route}?${query}`, { method: "GET", token });

// Midday in Dhaka, so the business day is the date written whatever the machine's clock.
const at = (day) => `${day} 06:00:00`;
let dress, scarf, dress_batch, scarf_batch;

const seed = async () => {
    await h.query("TRUNCATE campaign, partner, orders, inventory, product, sub_categories, customers CASCADE");
    const [category, sub_category] = [uuidv4(), uuidv4()];
    [dress, scarf, dress_batch, scarf_batch] = [uuidv4(), uuidv4(), uuidv4(), uuidv4()];
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'All', 'ALL', $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, status) VALUES ($1, 'Floral dress', $3, $4, 'Active'), ($2, 'Silk scarf', $3, $4, 'Active')", [dress, scarf, category, sub_category]);
    // A dress sells at 1,000 and cost 400: 600 profit a unit.
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, status) VALUES ($1, 'B-D', $2, 500, 500, 400, 'ready_for_sale'), ($3, 'B-S', $4, 5000, 5000, 100, 'ready_for_sale')", [dress_batch, dress, scarf_batch, scarf]);
};

const sale = async (day, product, batch, quantity, unit_price, { discount = 0, returned = 0, customer = null, channel = "POS" } = {}) => {
    const oid = uuidv4();
    await h.query("INSERT INTO orders (oid, invoice_no, total_amount, channel, status, sold_on, customer_oid) VALUES ($1, $1, 0, $3, 'Purchased', $2, $4)", [oid, at(day), channel, customer]);
    await h.query("INSERT INTO order_items (oid, order_oid, inventory_oid, product_oid, product_name, quantity, unit_price, discount, total, returned_qty) VALUES ($1, $2, $3, $4, 'Item', $5, $6, $7, 0, $8)", [uuidv4(), oid, batch, product, quantity, unit_price, discount, returned]);
    return oid;
};

// The worked example: a 14 day window, 2 to 15 September, and the 14 days before it.
const campaign = async ({ fee = 15000, batches = [dress_batch], start = "2026-09-02", end = "2026-09-12", measure = "2026-09-15", status = "Completed", name = "Winter dresses" } = {}) => {
    const [oid, partner] = [uuidv4(), uuidv4()];
    await h.query("INSERT INTO partner (oid, name, partner_type, status) VALUES ($1, $1, 'Page', 'Active')", [partner]);
    await h.query("INSERT INTO campaign (oid, campaign_no, name, promotion_type, status, posting_start, posting_end, measure_end) VALUES ($1, $7, $2, 'InfluencerPost', $3, $4, $5, $6)", [oid, name, status, start, end, measure, `CM-${oid.slice(0, 8)}`]);
    for (const b of batches) await h.query("INSERT INTO campaign_batch (oid, campaign_oid, inventory_oid) VALUES ($1, $2, $3)", [uuidv4(), oid, b]);
    await h.query("INSERT INTO campaign_partner (oid, campaign_oid, partner_oid, agreed_fee) VALUES ($1, $2, $3, $4)", [uuidv4(), oid, partner, fee]);
    return oid;
};

const example = async () => {
    await sale("2026-08-25", dress, dress_batch, 40, 1000);
    await sale("2026-09-05", dress, dress_batch, 70, 1000);
    await sale("2026-08-25", scarf, scarf_batch, 500, 300);
    await sale("2026-09-05", scarf, scarf_batch, 600, 300);
};

describe("marketing analytics", () => {
    beforeEach(async () => {
        await h.reset();
        await seed();
    });

    it("refuses someone who may run campaigns but not see marketing analytics", async () => {
        const token = await sign_in_with(["marketing.campaign.view", "sales.pos.view"]);
        for (const url of [OVERVIEW, RESULTS, COMPARISONS, SOURCES, NEXT]) assert.equal((await get(url, token)).status, 403, url);
    });

    it("works out the documented example: 22 extra dresses, 13,200 extra profit against 15,000, so sales rose but did not pay back", async () => {
        await example();
        await campaign();
        const [result] = (await get(RESULTS, await sign_in_with(MONEY))).body.data.results;
        assert.deepEqual([result.window_from, result.window_to, result.before_from, result.before_to, result.days], ["2026-09-02", "2026-09-15", "2026-08-19", "2026-09-01", 14]);
        assert.deepEqual([result.promoted_before, result.promoted_window, result.rest_before, result.rest_window, result.trend_percent], [40, 70, 500, 600, 20]);
        assert.deepEqual([result.expected, result.extra, result.profit_per_unit, result.extra_profit, result.cost], [48, 22, 600, 13200, 15000]);
        assert.deepEqual([result.verdict, result.return_per_taka], ["rose_not_paid", 0.88]);
    });

    it("says a campaign paid for itself when the extra profit covers what it cost", async () => {
        await example();
        await campaign({ fee: 5000 });
        const [result] = (await get(RESULTS, await sign_in_with(MONEY))).body.data.results;
        assert.equal(result.verdict, "paid");
    });

    it("finds no rise when the promoted products did no better than the rest of the business", async () => {
        await sale("2026-08-25", dress, dress_batch, 50, 1000);
        await sale("2026-09-05", dress, dress_batch, 55, 1000);
        await sale("2026-08-25", scarf, scarf_batch, 500, 300);
        await sale("2026-09-05", scarf, scarf_batch, 600, 300);
        await campaign();
        const [result] = (await get(RESULTS, await sign_in_with(MONEY))).body.data.results;
        assert.deepEqual([result.verdict, result.return_per_taka], ["no_rise", null]);
    });

    it("will not judge on too little, and leaves out a promoted product that sold nothing before", async () => {
        await sale("2026-08-25", dress, dress_batch, 5, 1000);
        await sale("2026-09-05", dress, dress_batch, 9, 1000);
        await sale("2026-08-25", scarf, scarf_batch, 500, 300);
        await sale("2026-09-05", scarf, scarf_batch, 600, 300);
        await campaign();
        let [result] = (await get(RESULTS, await sign_in_with(MONEY))).body.data.results;
        assert.deepEqual([result.verdict, result.reason], ["too_little", "few_units"]);

        await h.query("TRUNCATE campaign CASCADE");
        await sale("2026-09-06", scarf, scarf_batch, 30, 300);
        await campaign({ batches: [dress_batch, scarf_batch] });
        [result] = (await get(RESULTS, await sign_in_with(MONEY))).body.data.results;
        assert.equal(result.reason, "no_rest", "with both products promoted nothing is left to compare with");
    });

    it("counts kept units at the price less its per unit discount, and leaves the money out for someone who may not see buying prices", async () => {
        // 40 before; 75 sold in the window at 1,000 less 100 off each, 5 of them returned: 70 kept at 900, so 500 profit a unit.
        await sale("2026-08-25", dress, dress_batch, 40, 1000);
        await sale("2026-09-05", dress, dress_batch, 75, 1000, { discount: 100, returned: 5 });
        await sale("2026-08-25", scarf, scarf_batch, 500, 300);
        await sale("2026-09-05", scarf, scarf_batch, 600, 300);
        await campaign();
        const [result] = (await get(RESULTS, await sign_in_with(MONEY))).body.data.results;
        assert.deepEqual([result.promoted_window, result.profit_per_unit, result.extra_profit], [70, 500, 11000]);

        const [hidden] = (await get(RESULTS, await sign_in_with(OWNER))).body.data.results;
        assert.deepEqual([hidden.verdict, hidden.profit_per_unit, hidden.extra_profit, hidden.return_per_taka, hidden.money_hidden], [result.verdict, null, null, null, true]);
    });

    it("counts products given at cost in what a campaign cost, shown only with the buying price permission", async () => {
        await example();
        const id = await campaign({ fee: 0 });
        const line = (await h.query("SELECT oid FROM campaign_partner WHERE campaign_oid = $1", [id]))[0].oid;
        const gift = uuidv4();
        await h.query("INSERT INTO giveaway (oid, giveaway_no, recipient_name, note, status, campaign_partner_oid) VALUES ($1, 'GFT-1', 'Page', 'Seeding', 'Given', $2)", [gift, line]);
        await h.query("INSERT INTO giveaway_line (oid, giveaway_oid, inventory_oid, product_oid, quantity, cost_price) VALUES ($1, $2, $3, $4, 10, 100)", [uuidv4(), gift, scarf_batch, scarf]);
        const [result] = (await get(RESULTS, await sign_in_with(MONEY))).body.data.results;
        assert.deepEqual([result.cost, result.no_cost_recorded], [1000, false]);
        const [hidden] = (await get(RESULTS, await sign_in_with(OWNER))).body.data.results;
        assert.equal(hidden.cost, 0);
    });

    it("counts a first-time customer as buying a promoted product only if they kept one", async () => {
        await example();
        await campaign();
        await h.query("INSERT INTO customers (oid, name, phone, phone_normalized) VALUES ('CU-1', 'A', '01711000001', '01711000001'), ('CU-2', 'B', '01711000002', '01711000002')");
        await sale("2026-09-06", dress, dress_batch, 1, 1000, { customer: "CU-1" });
        await sale("2026-09-07", dress, dress_batch, 1, 1000, { customer: "CU-2", returned: 1 });
        await sale("2026-09-07", scarf, scarf_batch, 1, 300, { customer: "CU-2" });
        const [result] = (await get(RESULTS, await sign_in_with(MONEY))).body.data.results;
        assert.deepEqual([result.first_time, result.first_time_promoted], [2, 1]);
    });

    it("marks two campaigns that promote the same product in overlapping days", async () => {
        await example();
        await campaign();
        await campaign({ name: "Eid looks", start: "2026-09-10", end: "2026-09-14", measure: "2026-09-17" });
        const results = (await get(RESULTS, await sign_in_with(MONEY))).body.data.results;
        const winter = results.find((r) => r.name === "Winter dresses");
        assert.deepEqual(winter.overlaps.map((o) => [o.name, o.days, o.products]), [["Eid looks", 6, ["Floral dress"]]]);
    });

    it("draws every day of the period with its first-time customers, the campaigns on it and what was posted, and leaves the gift cost to those who may see it", async () => {
        await example();
        const id = await campaign();
        const line = (await h.query("SELECT oid FROM campaign_partner WHERE campaign_oid = $1", [id]))[0].oid;
        await h.query("INSERT INTO campaign_deliverable (oid, campaign_partner_oid, kind, quantity, due_on, status, posted_on) VALUES ($1, $2, 'Reel', 1, '2026-09-04', 'Posted', '2026-09-04')", [uuidv4(), line]);
        const data = (await get(OVERVIEW, await sign_in_with(OWNER))).body.data;
        assert.equal(data.daily.length, 30);
        assert.equal(data.daily.find((d) => d.day === "2026-09-05").sales, 70 * 1000 + 600 * 300);
        assert.deepEqual(data.campaigns.map((c) => [c.name, c.posted.map((p) => p.day)]), [["Winter dresses", ["2026-09-04"]]]);
        assert.equal(data.given, null);
        assert.notEqual((await get(OVERVIEW, await sign_in_with([...OWNER, "inventory.stock-value.view"]))).body.data.given, null);
    });
});


describe("sources, partners and types compared, and who a campaign brought", () => {
    beforeEach(async () => {
        await h.reset();
        await seed();
    });

    it("compares promotion types and partners, with what each partner delivered", async () => {
        await example();
        const id = await campaign();
        const line = (await h.query("SELECT oid FROM campaign_partner WHERE campaign_oid = $1", [id]))[0].oid;
        await h.query("INSERT INTO campaign_deliverable (oid, campaign_partner_oid, kind, quantity, due_on, status, posted_on) VALUES ($1, $3, 'Reel', 1, '2026-09-04', 'Posted', '2026-09-04'), ($2, $3, 'Story', 1, '2026-09-05', 'Late', '2026-09-07')", [uuidv4(), uuidv4(), line]);
        const data = (await get(COMPARISONS, await sign_in_with(MONEY))).body.data;
        assert.deepEqual(data.types.map((t) => [t.promotion_type, t.campaigns, t.cost, t.return_per_taka]), [["InfluencerPost", 1, 15000, 0.88]]);
        assert.deepEqual(data.partners.map((p) => [p.campaigns, p.fees, p.average_extra, p.on_time, p.late, p.missed]), [[1, 15000, 22, 1, 1, 0]]);
        assert.equal((await get(COMPARISONS, await sign_in_with(OWNER))).body.data.types[0].return_per_taka, null, "no ratio a buying price could come from");
    });

    it("compares the sources online orders came through: placed, sold, cancelled, refused and first-time customers", async () => {
        const source = uuidv4();
        await h.query("INSERT INTO order_source (oid, platform, name) VALUES ($1, 'Facebook', 'Main page')", [source]);
        await h.query("INSERT INTO customers (oid, name, phone, phone_normalized) VALUES ('CU-1', 'A', '01711000001', '01711000001')");
        const placed = async (status, extra = {}) => {
            const oid = await sale("2026-09-05", dress, dress_batch, 1, 1000, { channel: "ONLINE", ...extra });
            await h.query("UPDATE orders SET status = $2::text, sold_on = CASE WHEN $2::text = 'Delivered' THEN sold_on END WHERE oid = $1", [oid, status]);
            await h.query("INSERT INTO online_order (order_oid, source_oid, delivery_status) VALUES ($1, $2, $3)", [oid, source, extra.delivery ?? null]);
            await h.query("INSERT INTO order_status_history (oid, order_oid, to_status, performed_on) VALUES ($1, $2, 'Pending', $3)", [uuidv4(), oid, at("2026-09-04")]);
            if (extra.reason) await h.query("UPDATE orders SET cancel_reason_code = $2 WHERE oid = $1", [oid, extra.reason]);
        };
        await placed("Delivered", { customer: "CU-1" });
        await placed("Delivered");
        await placed("Cancelled");
        await placed("Confirmed", { delivery: "Failed" });
        await placed("Cancelled", { reason: "out_of_stock" });
        const data = (await get(SOURCES, await sign_in_with(MONEY))).body.data;
        assert.deepEqual(data.sources.map((s) => [s.name, s.placed, s.sold, s.cancelled, s.refused, s.sales, s.first_time]), [["Main page", 5, 2, 1, 1, 2000, 1]], "the out of stock cancellation is the business's, not the source's");
        assert.equal((await get(SOURCES, await sign_in_with(OWNER))).body.data.sources[0].profit, null);
        assert.equal((await get(SOURCES, await sign_in_with(["marketing.analytics.view", "sales.pos.view"]))).body.data.applies, false);
    });

    it("names who a campaign brought by gender, age and district, beside the buyers before it", async () => {
        await example();
        await campaign();
        await h.query("INSERT INTO customers (oid, name, phone, phone_normalized, gender, age_band) VALUES ('CU-1', 'A', '01711000001', '01711000001', 'Female', '18_24'), ('CU-2', 'B', '01711000002', '01711000002', 'Male', '35_44')");
        await sale("2026-08-26", scarf, scarf_batch, 1, 300, { customer: "CU-2" });
        const oid = await sale("2026-09-06", dress, dress_batch, 1, 1000, { customer: "CU-1", channel: "ONLINE" });
        await h.query("INSERT INTO online_order (order_oid, district_oid) VALUES ($1, 'BD-Dhaka')", [oid]);
        const returned = await sale("2026-09-06", scarf, scarf_batch, 1, 300, { customer: "CU-1", channel: "ONLINE" });
        await h.query("UPDATE orders SET status = 'Returned' WHERE oid = $1", [returned]);
        await h.query("INSERT INTO online_order (order_oid, district_oid) VALUES ($1, 'BD-Bhola')", [returned]);
        const [result] = (await get(RESULTS, await sign_in_with(MONEY))).body.data.results;
        assert.deepEqual(result.brought, [{ gender: "Female", age_band: "18_24", customers: 1 }]);
        assert.deepEqual(result.usual, [{ gender: "Male", age_band: "35_44", customers: 1 }]);
        assert.deepEqual(result.districts.map((d) => [d.oid, d.customers]), [["BD-Dhaka", 1]], "a parcel sent back in full adds no district");
    });
});

describe("what to promote next", () => {
    beforeEach(async () => {
        await h.reset();
        await seed();
    });

    it("suggests a product rising with no campaign behind it, the category no campaign reached, and when orders arrive", async () => {
        await sale("2026-08-20", dress, dress_batch, 20, 1000);
        await sale("2026-08-20", scarf, scarf_batch, 100, 300);
        await sale("2026-09-10", dress, dress_batch, 50, 1000);
        await sale("2026-09-10", scarf, scarf_batch, 100, 300);
        for (let n = 0; n < 20; n++) await sale("2026-09-09", scarf, scarf_batch, 1, 300);
        const { suggestions } = (await get(NEXT, await sign_in_with(OWNER))).body.data;
        assert.deepEqual(suggestions.map((s) => s.kind), ["rising", "audience", "arrivals"]);
        assert.deepEqual(suggestions[0].products.map((p) => [p.name, p.units_before, p.units_window, p.expected, p.extra]), [["Floral dress", 20, 50, 24, 26]], "the scarf grew no faster than the rest");
        assert.deepEqual([suggestions[1].category.name, suggestions[1].sales, suggestions[1].age_band], ["Clothing", 86000, null]);
        assert.deepEqual([suggestions[2].total, suggestions[2].weekday, suggestions[2].weekday_orders, suggestions[2].hour], [22, new Date("2026-09-09").getUTCDay(), 20, 12]);
    });

    it("names the promotion type and partner that paid for themselves, and never calls a promoted product's rise unpaid for", async () => {
        await example();
        await campaign({ fee: 5000 });
        const { suggestions } = (await get(NEXT, await sign_in_with(MONEY))).body.data;
        assert.deepEqual(suggestions.map((s) => s.kind), ["type", "partner"], "the dress was promoted, and its category with it");
        assert.deepEqual([suggestions[0].promotion_type, suggestions[0].paid, suggestions[0].return_per_taka], ["InfluencerPost", 1, 2.64]);
        assert.equal((await get(NEXT, await sign_in_with(OWNER))).body.data.suggestions[1].return_per_taka, null, "no ratio a buying price could come from");
    });

    it("never suggests from online sales to someone who sells only at the counter", async () => {
        await sale("2026-08-20", dress, dress_batch, 20, 1000, { channel: "ONLINE" });
        await sale("2026-08-20", scarf, scarf_batch, 100, 300, { channel: "ONLINE" });
        await sale("2026-09-10", dress, dress_batch, 50, 1000, { channel: "ONLINE" });
        await sale("2026-09-10", scarf, scarf_batch, 100, 300, { channel: "ONLINE" });
        const { suggestions } = (await get(NEXT, await sign_in_with(["marketing.analytics.view", "sales.pos.view"]))).body.data;
        assert.deepEqual(suggestions, []);
    });
});
