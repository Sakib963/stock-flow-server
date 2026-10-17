const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const OVERVIEW = CONTEXTS.SALES + SUB_CONTEXTS.ANALYTICS + ROUTES.GET_SALES_ANALYTICS_OVERVIEW;
const OWNER = ["sales.analytics.view", "sales.pos.view", "sales.online.view"];

before(h.start);
after(h.stop);

let seq = 0;
const person = async (permissions) => {
    const user = await h.seed_user({ email: `analyst${++seq}@arithmalabs.test`, permissions });
    return (await h.sign_in(user)).access;
};

const overview = (token, query = "") => h.call(`${OVERVIEW}?date_from=2026-10-01&date_to=2026-10-31${query}`, { method: "GET", token });

const seed_catalogue = async () => {
    await h.query("TRUNCATE return_details, product_return, online_order, order_items, orders, inventory, product, sub_categories CASCADE");
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ('C-1', 'Kurti', 'KUR', 'Active'), ('C-2', 'Bags', 'BAG', 'Active')");
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ('S-1', 'Printed', 'PRI', 'C-1', 'Active'), ('S-2', 'Tote', 'TOT', 'C-2', 'Active')");
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid) VALUES ('P-1', 'Floral Kurti', 'C-1', 'S-1'), ('P-2', 'Tote Bag', 'C-2', 'S-2')");
    // The same kurti bought at two costs: a sale costs what its own batch cost.
    await h.query(
        "INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, status) VALUES ('I-1', 'B-1', 'P-1', 50, 50, 300, 'ready_for_sale'), ('I-2', 'B-2', 'P-1', 50, 50, 400, 'ready_for_sale'), ('I-3', 'B-3', 'P-2', 50, 50, 200, 'ready_for_sale')"
    );
};

// Midday in Dhaka, so the business day is the date written whatever the machine's clock.
const at = (day) => `${day} 06:00:00`;

const order = async ({ channel = "POS", status = "Purchased", sold_on = null, dispatched_on = null, delivery_status = null, delivery_charge = 0, lines }) => {
    const oid = uuidv4();
    await h.query("INSERT INTO orders (oid, invoice_no, total_amount, channel, status, sold_on, dispatched_on, delivery_charge) VALUES ($1, $1, 0, $2, $3, $4, $5, $6)", [oid, channel, status, sold_on, dispatched_on, delivery_charge]);
    if (channel === "ONLINE") await h.query("INSERT INTO online_order (order_oid, delivery_status) VALUES ($1, $2)", [oid, delivery_status]);
    for (const line of lines) {
        await h.query("INSERT INTO order_items (oid, order_oid, inventory_oid, product_oid, product_name, quantity, unit_price, discount, total, returned_qty) VALUES ($1, $2, $3, $4, 'Item', $5, $6, $7, 0, $8)", [
            uuidv4(),
            oid,
            line.batch,
            line.product ?? "P-1",
            line.quantity,
            line.unit_price,
            line.discount ?? 0,
            line.returned ?? 0,
        ]);
    }
    return oid;
};

describe("sales overview", () => {
    beforeEach(async () => {
        await h.reset();
        await seed_catalogue();
    });

    it("refuses someone who may sell but not see analytics", async () => {
        const res = await overview(await person(["sales.pos.view", "sales.online.view"]));
        assert.equal(res.status, 403);
    });

    it("refuses a day that does not exist", async () => {
        const res = await h.call(`${OVERVIEW}?date_from=2026-02-30`, { method: "GET", token: await person(OWNER) });
        assert.equal(res.status, 400);
    });

    it("refuses a period that ends before it starts", async () => {
        const res = await h.call(`${OVERVIEW}?date_from=2026-10-10&date_to=2026-10-01`, { method: "GET", token: await person(OWNER) });
        assert.equal(res.status, 400);
    });

    it("starts a period given only its end day at the start of that day's month", async () => {
        const res = await h.call(`${OVERVIEW}?date_to=2026-09-15`, { method: "GET", token: await person(OWNER) });
        assert.equal(res.body.data.period.date_from, "2026-09-01");
    });

    it("counts what was kept at the line price less each batch's cost, and nothing that is not a sale", async () => {
        // 2 kurtis at 1000 less 100 a unit from B-1 (cost 300), one of them returned.
        await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 2, unit_price: 1000, discount: 100, returned: 1 }] });
        // 1 kurti at 1000 from B-2 (cost 400), online with a delivery charge that is never sales.
        await order({ channel: "ONLINE", status: "Delivered", sold_on: at("2026-10-06"), dispatched_on: at("2026-10-04"), delivery_status: "Delivered", delivery_charge: 60, lines: [{ batch: "I-2", quantity: 1, unit_price: 1000 }] });
        // A sale returned in full adds nothing.
        await order({ status: "Returned", sold_on: at("2026-10-07"), lines: [{ batch: "I-1", quantity: 1, unit_price: 1000, returned: 1 }] });
        // Pending and cancelled orders are intentions, never sales.
        await order({ channel: "ONLINE", status: "Pending", lines: [{ batch: "I-1", quantity: 5, unit_price: 1000 }] });
        await order({ status: "Cancelled", lines: [{ batch: "I-1", quantity: 5, unit_price: 1000 }] });

        const res = await overview(await person(OWNER));
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const { tiles, waterfall } = res.body.data;
        assert.equal(tiles.sales.current, 900 + 1000);
        assert.equal(tiles.profit.current, 900 - 300 + (1000 - 400));
        assert.equal(tiles.orders.current, 2);
        assert.deepEqual(waterfall, { list_price: 2000 + 1000 + 1000, discounts: 200, returns: 900 + 1000, cost: 700, profit: 1200, units_without_cost: 0 });
        assert.deepEqual(res.body.data.insights.waterfall, { key: "of_every_hundred", params: { profit: 30, discounts: 5, returns: 48 } });
    });

    it("dates a sale by the day it was sold and compares with the same number of days before", async () => {
        await order({ sold_on: at("2026-10-10"), lines: [{ batch: "I-1", quantity: 3, unit_price: 1000 }] });
        await order({ sold_on: at("2026-09-20"), lines: [{ batch: "I-1", quantity: 2, unit_price: 1000 }] });
        await order({ sold_on: at("2026-08-31"), lines: [{ batch: "I-1", quantity: 9, unit_price: 1000 }] });

        const res = await overview(await person(OWNER));
        const { period, tiles, daily, insights } = res.body.data;
        assert.deepEqual(period, { date_from: "2026-10-01", date_to: "2026-10-31", previous_from: "2026-08-31", previous_to: "2026-09-30" });
        assert.deepEqual(tiles.sales, { current: 3000, previous: 2000 + 9000 });
        assert.deepEqual(daily, [{ day: "2026-10-10", sales: 3000, profit: 2100 }]);
        assert.deepEqual(insights.headline, { key: "sales_down", params: { change: 73 } });
    });

    it("gives someone who sells at the counter only their counter sales and no refusal figure", async () => {
        await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 1, unit_price: 500 }] });
        await order({ channel: "ONLINE", status: "Delivered", sold_on: at("2026-10-05"), dispatched_on: at("2026-10-04"), delivery_status: "Delivered", lines: [{ batch: "I-1", quantity: 1, unit_price: 900 }] });

        const res = await overview(await person(["sales.analytics.view", "sales.pos.view"]));
        assert.equal(res.body.data.tiles.sales.current, 500);
        assert.equal(res.body.data.tiles.refusal, null);
        assert.deepEqual(res.body.data.channels, ["POS"]);
        assert.deepEqual(res.body.data.sources, []);
    });

    it("counts parcels that never reached the customer against parcels handed to the courier", async () => {
        for (const delivery_status of ["Delivered", "Delivered", "Failed", "BackInShop"]) {
            await order({ channel: "ONLINE", status: "Confirmed", dispatched_on: at("2026-10-03"), delivery_status, lines: [{ batch: "I-1", quantity: 1, unit_price: 500 }] });
        }
        const res = await overview(await person(OWNER));
        assert.deepEqual(res.body.data.tiles.refusal.current, { dispatched: 4, failed: 2 });
    });

    it("offers the business's sources to someone who sells online and narrows the figures to one", async () => {
        await h.query("TRUNCATE order_source CASCADE");
        await h.query("INSERT INTO order_source (oid, platform, name) VALUES ('SRC-FB', 'Facebook', 'Main page'), ('SRC-IG', 'Instagram', 'Shop account')");
        const sold = await order({ channel: "ONLINE", status: "Delivered", sold_on: at("2026-10-05"), dispatched_on: at("2026-10-04"), delivery_status: "Delivered", lines: [{ batch: "I-1", quantity: 1, unit_price: 800 }] });
        await h.query("UPDATE online_order SET source_oid = 'SRC-FB' WHERE order_oid = $1", [sold]);
        await order({ channel: "ONLINE", status: "Delivered", sold_on: at("2026-10-05"), dispatched_on: at("2026-10-04"), delivery_status: "Delivered", lines: [{ batch: "I-1", quantity: 1, unit_price: 500 }] });

        const token = await person(OWNER);
        const all = await overview(token);
        assert.deepEqual(all.body.data.sources.map((s) => s.name), ["Main page", "Shop account"]);
        assert.equal((await overview(token, "&source_oid=SRC-FB")).body.data.tiles.sales.current, 800);
    });

    it("splits sales between the counter and online when both are in the figures, and not for one channel", async () => {
        await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 2, unit_price: 1000 }] });
        await order({ channel: "ONLINE", status: "Delivered", sold_on: at("2026-10-06"), dispatched_on: at("2026-10-05"), delivery_status: "Delivered", lines: [{ batch: "I-2", quantity: 1, unit_price: 1000 }] });
        const token = await person(OWNER);
        assert.deepEqual((await overview(token)).body.data.by_channel, [
            { channel: "ONLINE", sales: 1000, profit: 600, orders: 1 },
            { channel: "POS", sales: 2000, profit: 1400, orders: 1 },
        ]);
        assert.equal((await overview(token, "&channel=POS")).body.data.by_channel, null);
        assert.equal((await overview(await person(["sales.analytics.view", "sales.pos.view"]))).body.data.by_channel, null);
    });

    it("narrows every figure to one category and one channel", async () => {
        await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 1, unit_price: 1000 }, { batch: "I-3", product: "P-2", quantity: 1, unit_price: 700 }] });
        await order({ channel: "ONLINE", status: "Delivered", sold_on: at("2026-10-05"), dispatched_on: at("2026-10-04"), delivery_status: "Delivered", lines: [{ batch: "I-3", product: "P-2", quantity: 2, unit_price: 700 }] });

        const token = await person(OWNER);
        assert.equal((await overview(token, "&category_oid=C-2")).body.data.tiles.sales.current, 700 * 3);
        assert.equal((await overview(token, "&category_oid=C-2&channel=POS")).body.data.tiles.sales.current, 700);
    });
});

const ORDERS = CONTEXTS.SALES + SUB_CONTEXTS.ANALYTICS + ROUTES.GET_SALES_ANALYTICS_ORDERS;
const orders = (token, query = "") => h.call(`${ORDERS}?date_from=2026-10-01&date_to=2026-10-31${query}`, { method: "GET", token });

const seed_places = async () => {
    await h.query("TRUNCATE district, division CASCADE");
    await h.query("INSERT INTO division (oid, name_en, name_bn) VALUES ('BD-Dhaka-Division', 'Dhaka Division', 'ঢাকা বিভাগ')");
    await h.query("INSERT INTO district (oid, name_en, name_bn, division_oid) VALUES ('BD-Dhaka', 'Dhaka', 'ঢাকা', 'BD-Dhaka-Division'), ('BD-Gazipur', 'Gazipur', 'গাজীপুর', 'BD-Dhaka-Division')");
};

// An online order placed on a day, followed to wherever it ended.
const online = async ({ status = "Pending", confirmed = false, via = null, dispatched = false, delivery_status = null, sold = false, cancel = null, terms = "COD", district = "BD-Dhaka", flag = "None", own = null, quantity = 1, returned = 0, hours = {}, placed = true, saved = "2026-10-05 04:00:00", customer = null, source = null, lines = null }) => {
    const oid = uuidv4();
    const created = saved;
    // Every later step is timed from the placing, as the app does.
    const from = new Date(`${typeof placed === "string" ? placed : created}Z`.replace(" ", "T"));
    const plus = (h) => new Date(from.getTime() + h * 3_600_000).toISOString().replace("T", " ").slice(0, 19);
    await h.query(
        "INSERT INTO orders (oid, invoice_no, total_amount, channel, status, created_on, sold_on, dispatched_on, delivered_on, cancel_reason_code, payment_type, payment_status, amount_paid) VALUES ($1, $1, 0, 'ONLINE', $2, $3, $4, $5, $4, $6, $7, $8, $9)",
        [oid, status, created, sold ? plus(hours.deliver ?? 9) : null, dispatched ? plus(hours.dispatch ?? 5) : null, cancel, terms, terms === "COD" ? "unpaid" : "partially_paid", terms === "COD" ? 0 : 100]
    );
    if (customer) await h.query("UPDATE orders SET customer_oid = $2 WHERE oid = $1", [oid, customer]);
    await h.query("INSERT INTO online_order (order_oid, district_oid, source_oid, confirmed_on, confirmed_via, delivery_status, risk_flag, risk_own_delivered_rate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [oid, district, source, confirmed ? plus(hours.confirm ?? 2) : null, confirmed ? via : null, delivery_status, flag, own]);
    // Placing writes the order's first Pending row, as create-online-order does; a discarded draft never had one.
    if (placed) await h.query("INSERT INTO order_status_history (oid, order_oid, from_status, to_status, performed_on) VALUES ($1, $2, NULL, 'Pending', $3)", [uuidv4(), oid, placed === true ? created : placed]);
    for (const line of lines ?? [{ batch: "I-1", product: "P-1", quantity, unit_price: 500, returned }]) {
        await h.query("INSERT INTO order_items (oid, order_oid, inventory_oid, product_oid, product_name, quantity, unit_price, discount, total, returned_qty) VALUES ($1, $2, $3, $4, 'Item', $5, $6, 0, 0, $7)", [uuidv4(), oid, line.batch, line.product, line.quantity, line.unit_price, line.returned ?? 0]);
    }
    return oid;
};

const delivered = (extra = {}) => online({ status: "Delivered", confirmed: true, via: "PhoneCall", dispatched: true, delivery_status: "Delivered", sold: true, ...extra });
const refused = (extra = {}) => online({ status: "Confirmed", confirmed: true, via: "PhoneCall", dispatched: true, delivery_status: "Failed", ...extra });

describe("online orders analytics", () => {
    beforeEach(async () => {
        await h.reset();
        await seed_catalogue();
        await seed_places();
    });

    it("refuses someone who may sell online but not see analytics", async () => {
        const res = await orders(await person(["sales.online.view"]));
        assert.equal(res.status, 403);
    });

    it("never counts a discarded draft as a placed order", async () => {
        await online({ status: "Cancelled", placed: false });
        const { funnel, cancel_reasons } = (await orders(await person(OWNER))).body.data;
        assert.equal(funnel.placed, 0);
        assert.deepEqual(cancel_reasons, []);
    });

    it("dates a draft placed later by the day it was placed, and times confirming from then", async () => {
        await online({ saved: "2026-09-30 17:00:00", placed: "2026-10-01 04:00:00", confirmed: true, via: "PhoneCall", hours: { confirm: 1 } });
        const token = await person(OWNER);
        const october = (await orders(token)).body.data;
        assert.equal(october.funnel.placed, 1);
        assert.equal(october.speed.to_confirm, 1);
        const september = (await h.call(`${ORDERS}?date_from=2026-09-01&date_to=2026-09-30`, { method: "GET", token })).body.data;
        assert.equal(september.funnel.placed, 0);
    });

    it("counts a cancellation with no reason against the place, as the customer's", async () => {
        await online({ status: "Cancelled" });
        await online({});
        const { places } = (await orders(await person(OWNER))).body.data;
        assert.deepEqual([places[0].placed, places[0].cancelled, places[0].business_cancelled], [2, 1, 0]);
    });

    it("values only the lines in the chosen category", async () => {
        await delivered({ lines: [{ batch: "I-1", product: "P-1", quantity: 1, unit_price: 500 }, { batch: "I-3", product: "P-2", quantity: 1, unit_price: 700 }] });
        await delivered();
        const { funnel } = (await orders(await person(OWNER), "&category_oid=C-2")).body.data;
        assert.deepEqual([funnel.placed, funnel.placed_value, funnel.kept_value], [1, 700, 700]);
    });

    it("narrows the section to one source", async () => {
        await h.query("TRUNCATE order_source CASCADE");
        await h.query("INSERT INTO order_source (oid, platform, name) VALUES ('SRC-FB', 'Facebook', 'Main page')");
        await delivered({ source: "SRC-FB" });
        await delivered();
        const { funnel, sources } = (await orders(await person(OWNER), "&source_oid=SRC-FB")).body.data;
        assert.equal(funnel.placed, 1);
        assert.deepEqual(sources.map((s) => [s.name, s.placed]), [["Main page", 1]]);
    });

    it("names only customers who called off two or more orders themselves", async () => {
        await h.query("TRUNCATE customers CASCADE");
        await h.query("INSERT INTO customers (oid, name, phone, phone_normalized) VALUES ('CU-1', 'Person A', '01711000001', '01711000001'), ('CU-2', 'Person B', '01711000002', '01711000002')");
        await online({ status: "Cancelled", cancel: "fake_order", customer: "CU-1" });
        await online({ status: "Cancelled", cancel: "changed_mind", customer: "CU-1" });
        await online({ status: "Cancelled", cancel: "fake_order", customer: "CU-2" });
        await online({ status: "Cancelled", cancel: "out_of_stock", customer: "CU-2" });
        const { customers } = (await orders(await person(OWNER))).body.data;
        assert.deepEqual(customers.map((c) => [c.name, c.cancelled]), [["Person A", 2]]);
    });

    it("counts a warned order returned in full as returned, not still open", async () => {
        await delivered({ flag: "Watch", status: "Returned", returned: 1 });
        const { risk } = (await orders(await person(OWNER))).body.data;
        assert.deepEqual([risk[0].shown, risk[0].returned, risk[0].open], ["watch", 1, 0]);
    });

    it("tells someone who sells only at the counter that the section does not apply", async () => {
        const res = await orders(await person(["sales.analytics.view", "sales.pos.view"]));
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data, { applies: false });
    });

    it("follows every placed order to where it is now, step by step", async () => {
        await online({});
        await online({ status: "Cancelled", cancel: "changed_mind" });
        await online({ status: "Cancelled", confirmed: true, via: "PhoneCall", cancel: "out_of_stock" });
        await refused();
        await delivered();
        await delivered({ status: "Returned", returned: 1 });

        const { funnel, cancel_reasons, insights } = (await orders(await person(OWNER))).body.data;
        assert.deepEqual(
            { placed: funnel.placed, confirmed: funnel.confirmed, dispatched: funnel.dispatched, delivered: funnel.delivered, kept: funnel.kept, waiting_confirm: funnel.waiting_confirm, returned: funnel.returned },
            { placed: 6, confirmed: 4, dispatched: 3, delivered: 2, kept: 1, waiting_confirm: 1, returned: 1 }
        );
        assert.equal(funnel.placed_value, 3000);
        assert.equal(funnel.kept_value, 500);
        assert.deepEqual(cancel_reasons, [
            { reason: "changed_mind", business: false, before_confirm: 1, after_confirm: 0 },
            { reason: "out_of_stock", business: true, before_confirm: 0, after_confirm: 1 },
        ]);
        assert.ok(insights.funnel.key.startsWith("funnel_leak_"));
    });

    it("never counts the business's own cancellations against a place", async () => {
        await online({ status: "Cancelled", cancel: "out_of_stock" });
        await online({ status: "Cancelled", cancel: "fake_order" });
        await delivered({ district: "BD-Gazipur" });

        const { places } = (await orders(await person(OWNER))).body.data;
        const dhaka = places.find((p) => p.oid === "BD-Dhaka");
        assert.deepEqual({ placed: dhaka.placed, cancelled: dhaka.cancelled, business_cancelled: dhaka.business_cancelled }, { placed: 2, cancelled: 1, business_cancelled: 1 });
    });

    it("compares refused parcels by how they were confirmed once there are enough of them", async () => {
        for (let i = 0; i < 20; i++) await (i < 2 ? refused({ via: "PhoneCall" }) : delivered({ via: "PhoneCall" }));
        for (let i = 0; i < 20; i++) await (i < 8 ? refused({ via: "NotNeeded" }) : delivered({ via: "NotNeeded" }));

        const { confirming, insights } = (await orders(await person(OWNER))).body.data;
        assert.deepEqual(confirming.map((c) => [c.method, c.dispatched, c.failed]).sort(), [
            ["NotNeeded", 20, 8],
            ["PhoneCall", 20, 2],
        ]);
        assert.deepEqual(insights.confirming, { key: "confirm_compare", params: { bestKey: "sales.order.confirmedVia.PhoneCall", bestRate: 10, worstKey: "sales.order.confirmedVia.NotNeeded", worstRate: 40 } });
    });

    it("says nothing about confirming over too few parcels", async () => {
        await refused({ via: "NotNeeded" });
        await delivered({ via: "PhoneCall" });
        const { insights } = (await orders(await person(OWNER))).body.data;
        assert.equal(insights.confirming, null);
    });

    it("sorts orders by what intake showed and how they ended", async () => {
        await refused({ flag: "Watch" });
        await delivered({ own: 60 });
        await delivered({ own: 95 });
        await delivered();
        const { risk } = (await orders(await person(OWNER))).body.data;
        const by = Object.fromEntries(risk.map((r) => [r.shown, [r.kept, r.failed]]));
        assert.deepEqual(by, { watch: [0, 1], under_80: [1, 0], from_80: [1, 0], no_history: [1, 0] });
    });

    it("gives the middle time of each step in hours, so one slow parcel does not set it", async () => {
        await delivered({ hours: { confirm: 1, dispatch: 3, deliver: 9 } });
        await delivered({ hours: { confirm: 2, dispatch: 5, deliver: 15 } });
        await delivered({ hours: { confirm: 9, dispatch: 10, deliver: 19 } });
        const { speed } = (await orders(await person(OWNER))).body.data;
        assert.deepEqual(speed, { to_confirm: 2, to_dispatch: 2, to_deliver: 9 });
    });
});

const TEAM = CONTEXTS.SALES + SUB_CONTEXTS.ANALYTICS + ROUTES.GET_SALES_ANALYTICS_TEAM;
const team = (token, query = "") => h.call(`${TEAM}?date_from=2026-10-01&date_to=2026-10-31${query}`, { method: "GET", token });

describe("timing and people analytics", () => {
    beforeEach(async () => {
        await h.reset();
        await seed_catalogue();
        await seed_places();
    });

    it("refuses someone who may sell but not see analytics", async () => {
        const res = await team(await person(["sales.pos.view"]));
        assert.equal(res.status, 403);
    });

    it("places each order on the business's clock: a counter sale when sold, an online order when placed", async () => {
        // 06:00 UTC on Monday 5 October is noon in Dhaka; 04:00 UTC is 10 am.
        await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 1, unit_price: 500 }] });
        await online({});
        const { arrivals } = (await team(await person(OWNER))).body.data;
        assert.deepEqual(arrivals.map((a) => [a.channel, a.weekday, a.hour, a.orders]).sort(), [
            ["ONLINE", 1, 10, 1],
            ["POS", 1, 12, 1],
        ]);
    });

    it("puts a draft placed on a later day at the hour it was placed, not saved", async () => {
        // Saved Sunday 4 October 17:00 UTC (11 pm in Dhaka), placed Monday 5 October 04:00 UTC (10 am).
        await online({ saved: "2026-10-04 17:00:00", placed: "2026-10-05 04:00:00" });
        const { arrivals } = (await team(await person(OWNER))).body.data;
        assert.deepEqual(arrivals.map((a) => [a.weekday, a.hour]), [[1, 10]]);
    });

    it("counts discounts given on sales and the lines that went to their batch's limit", async () => {
        await h.query("UPDATE inventory SET maximum_discount = 100 WHERE oid IN ('I-1', 'I-2')");
        await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-2", quantity: 2, unit_price: 1000, discount: 100 }, { batch: "I-1", quantity: 1, unit_price: 1000, discount: 50 }, { batch: "I-3", product: "P-2", quantity: 1, unit_price: 700 }] });
        const { discount, discount_by_product, insights } = (await team(await person(OWNER))).body.data;
        assert.deepEqual(discount, { list_price: 3700, discount: 250, lines: 3, discounted_lines: 2, at_limit: 1 });
        assert.deepEqual(discount_by_product.map((p) => [p.name, p.discount]), [["Floral Kurti", 250]]);
        assert.deepEqual(insights.discount, { key: "discount_share", params: { share: 7, atLimit: 1, discounted: 2 } });
    });

    it("gives each person what they sold, the online orders they took and the ones they confirmed", async () => {
        // Two sold at 800 less 100, one of them returned: the seller keeps the sale of one.
        const counter = await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 2, unit_price: 800, discount: 100, returned: 1 }] });
        await h.query("UPDATE orders SET created_by = 'counter@arithmalabs.test' WHERE oid = $1", [counter]);
        const taken = await online({ status: "Cancelled", cancel: "fake_order" });
        const outOfStock = await online({ status: "Cancelled", cancel: "out_of_stock" });
        const sent = await refused();
        await h.query("UPDATE orders SET created_by = 'moderator@arithmalabs.test' WHERE oid = ANY($1)", [[taken, outOfStock, sent]]);
        await h.query("UPDATE online_order SET confirmed_by = 'manager@arithmalabs.test' WHERE order_oid = $1", [sent]);

        const { people } = (await team(await person(OWNER))).body.data;
        const by = Object.fromEntries(people.map((p) => [p.email, p]));
        assert.deepEqual([by["counter@arithmalabs.test"].sales, by["counter@arithmalabs.test"].discount], [700, 200]);
        const moderator = by["moderator@arithmalabs.test"];
        assert.deepEqual([moderator.taken, moderator.cancelled, moderator.business_cancelled, moderator.dispatched, moderator.failed], [3, 1, 1, 1, 1]);
        assert.equal(by["manager@arithmalabs.test"].confirmed, 1);
    });

    it("names the person whose online orders come back most, once each has sent 20", async () => {
        const make = async (who, sent, back) => {
            for (let i = 0; i < sent; i++) {
                const oid = await (i < back ? refused() : delivered());
                await h.query("UPDATE orders SET created_by = $2 WHERE oid = $1", [oid, who]);
            }
        };
        await make("moderator@arithmalabs.test", 20, 8);
        await make("other@arithmalabs.test", 20, 2);
        const { insights } = (await team(await person(OWNER))).body.data;
        assert.deepEqual(insights.people, { key: "people_refusal", params: { person: "moderator@arithmalabs.test", rate: 40, rest: 10 } });
    });

    it("narrows to one source, which leaves counter sales out", async () => {
        await h.query("TRUNCATE order_source CASCADE");
        await h.query("INSERT INTO order_source (oid, platform, name) VALUES ('SRC-FB', 'Facebook', 'Main page')");
        await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 1, unit_price: 500 }] });
        await online({ source: "SRC-FB" });
        await online({});
        const { arrivals } = (await team(await person(OWNER), "&source_oid=SRC-FB")).body.data;
        assert.deepEqual(arrivals.map((a) => [a.channel, a.orders]), [["ONLINE", 1]]);
    });

    it("leaves online orders out for someone who sells only at the counter", async () => {
        await online({});
        const { arrivals, people } = (await team(await person(["sales.analytics.view", "sales.pos.view"]))).body.data;
        assert.deepEqual([arrivals, people], [[], []]);
    });
});

const PRODUCTS = CONTEXTS.SALES + SUB_CONTEXTS.ANALYTICS + ROUTES.GET_SALES_ANALYTICS_PRODUCTS;
const products = (token, query = "") => h.call(`${PRODUCTS}?date_from=2026-10-01&date_to=2026-10-31${query}`, { method: "GET", token });

// Batch B-1 came from the supplier Mill on a purchase order; B-2 came in by a stock adjustment, so has no supplier.
const seed_supplier = async () => {
    await h.query("INSERT INTO supplier (oid, name, phone_number, status) VALUES ('SU-1', 'Mill', '01700000000', 'Active')");
    await h.query("INSERT INTO purchase (oid, supplier_oid, total_amount, paid_amount, status) VALUES ('PU-1', 'SU-1', 15000, 0, 'Verified')");
    await h.query("INSERT INTO purchase_details (oid, purchase_oid, product_oid, ordered_quantity, verified_quantity) VALUES ('PD-1', 'PU-1', 'P-1', 50, 50)");
    await h.query("UPDATE inventory SET purchase_details_oid = 'PD-1' WHERE oid = 'I-1'");
};

// A confirmed return of units from a sold order's line.
const confirmed_return = async (order_oid, { units, condition = "Good", reason = "size_or_fit" }) => {
    const [item] = await h.query("SELECT oid, product_oid, inventory_oid FROM order_items WHERE order_oid = $1 LIMIT 1", [order_oid]);
    const ret = uuidv4();
    await h.query("INSERT INTO product_return (oid, order_oid, invoice_no, refund_amount, return_reason, status) VALUES ($1, $2, $1, 0, $3, 'Returned')", [ret, order_oid, reason]);
    await h.query("INSERT INTO return_details (oid, return_oid, product_oid, inventory_oid, return_quantity, order_item_oid, condition) VALUES ($1, $2, $3, $4, $5, $6, $7)", [uuidv4(), ret, item.product_oid, item.inventory_oid, units, item.oid, condition]);
};

describe("products and suppliers analytics", () => {
    beforeEach(async () => {
        await h.reset();
        await seed_catalogue();
        await seed_places();
        await seed_supplier();
    });

    it("refuses someone who may sell but not see analytics", async () => {
        const res = await products(await person(["sales.pos.view"]));
        assert.equal(res.status, 403);
    });

    it("sets what each product kept against what was asked for, with what came back damaged", async () => {
        // Asked for online but not sold yet: demand, not a sale.
        await online({ quantity: 3 });
        const sale = await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 2, unit_price: 1000, returned: 1 }] });
        await confirmed_return(sale, { units: 1, condition: "Damaged", reason: "damaged_on_arrival" });

        const { products: rows, return_reasons } = (await products(await person(OWNER))).body.data;
        const kurti = rows.find((r) => r.oid === "P-1");
        assert.deepEqual([kurti.kept_units, kurti.demand_units, kurti.sales, kurti.profit, kurti.returned_units, kurti.damaged_units], [1, 5, 1000, 700, 1, 1]);
        assert.deepEqual(return_reasons, [{ reason: "damaged_on_arrival", units: 1, damaged: 1 }]);
    });

    it("finds products sold together in at least two orders", async () => {
        for (let i = 0; i < 2; i++) await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 1, unit_price: 500 }, { batch: "I-3", product: "P-2", quantity: 1, unit_price: 700 }] });
        await order({ sold_on: at("2026-10-06"), lines: [{ batch: "I-1", quantity: 1, unit_price: 500 }] });
        const { together } = (await products(await person(OWNER))).body.data;
        assert.deepEqual(together.map((t) => [t.first_name, t.second_name, t.orders]), [["Floral Kurti", "Tote Bag", 2]]);
    });

    it("leaves sales returned in full out of bought together and buyers", async () => {
        await h.query("TRUNCATE customers CASCADE");
        await h.query("INSERT INTO customers (oid, name, phone, phone_normalized, gender, age_band) VALUES ('CU-1', 'A', '01711000001', '01711000001', 'Female', '18_24')");
        for (let i = 0; i < 2; i++) {
            const oid = await order({ status: "Returned", sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 1, unit_price: 500, returned: 1 }, { batch: "I-3", product: "P-2", quantity: 1, unit_price: 700, returned: 1 }] });
            await h.query("UPDATE orders SET customer_oid = 'CU-1' WHERE oid = $1", [oid]);
        }
        const { together, buyers, totals } = (await products(await person(OWNER))).body.data;
        assert.deepEqual([together, buyers, totals.orders], [[], [], 0]);
    });

    it("leaves online demand out for someone who sells only at the counter", async () => {
        await online({ quantity: 3 });
        await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 2, unit_price: 1000 }] });
        const { products: rows } = (await products(await person(["sales.analytics.view", "sales.pos.view"]))).body.data;
        assert.equal(rows.find((r) => r.oid === "P-1").demand_units, 2);
    });

    it("narrows best sellers and suppliers to the category chosen", async () => {
        await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 1, unit_price: 1000 }, { batch: "I-3", product: "P-2", quantity: 1, unit_price: 700 }] });
        const { products: rows, suppliers } = (await products(await person(OWNER), "&category_oid=C-2")).body.data;
        assert.deepEqual(rows.map((r) => r.oid), ["P-2"]);
        assert.deepEqual(suppliers.map((s) => [s.oid, s.sales]), [[null, 700]]);
    });

    it("traces each sale to its supplier, and a batch with none to No supplier", async () => {
        await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 4, unit_price: 1000 }, { batch: "I-2", quantity: 1, unit_price: 1000 }] });
        const { suppliers } = (await products(await person(OWNER))).body.data;
        const mill = suppliers.find((s) => s.oid === "SU-1");
        assert.deepEqual([mill.name, mill.kept_units, mill.sales, mill.profit, mill.received_all_time, mill.kept_all_time], ["Mill", 4, 4000, 2800, 50, 4]);
        const none = suppliers.find((s) => s.oid === null);
        assert.equal(none.kept_units, 1);
    });

    it("counts each buyer once by recorded gender and age, and names the largest group", async () => {
        await h.query("TRUNCATE customers CASCADE");
        await h.query(
            "INSERT INTO customers (oid, name, phone, phone_normalized, gender, age_band) VALUES ('CU-1', 'A', '01711000001', '01711000001', 'Female', '18_24'), ('CU-2', 'B', '01711000002', '01711000002', 'Female', '18_24'), ('CU-3', 'C', '01711000003', '01711000003', NULL, NULL)"
        );
        for (const customer of ["CU-1", "CU-1", "CU-2", "CU-3"]) {
            const oid = await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 1, unit_price: 500 }] });
            await h.query("UPDATE orders SET customer_oid = $2 WHERE oid = $1", [oid, customer]);
        }
        const { buyers, insights } = (await products(await person(OWNER))).body.data;
        assert.deepEqual(buyers.map((b) => [b.gender, b.age_band, b.customers]).sort(), [
            [null, null, 1],
            ["Female", "18_24", 2],
        ]);
        assert.deepEqual(insights.buyers, { key: "buyers_top", params: { genderKey: "sales.customer.gender.Female", ageKey: "sales.customer.ageBand.18_24", share: 100, known: 67 } });
    });

    it("names what each age group kept most of, leaving out buyers with no age and units returned", async () => {
        await h.query("TRUNCATE customers CASCADE");
        await h.query(
            "INSERT INTO customers (oid, name, phone, phone_normalized, age_band) VALUES ('CU-1', 'A', '01711000001', '01711000001', '18_24'), ('CU-2', 'B', '01711000002', '01711000002', '35_44'), ('CU-3', 'C', '01711000003', '01711000003', NULL)"
        );
        const sale = async (customer, lines) => {
            const oid = await order({ sold_on: at("2026-10-05"), lines });
            await h.query("UPDATE orders SET customer_oid = $2 WHERE oid = $1", [oid, customer]);
        };
        await sale("CU-1", [{ batch: "I-1", quantity: 3, unit_price: 500 }, { batch: "I-3", product: "P-2", quantity: 1, unit_price: 800 }]);
        await sale("CU-2", [{ batch: "I-3", product: "P-2", quantity: 2, unit_price: 800, returned: 2 }, { batch: "I-1", quantity: 1, unit_price: 500 }]);
        await sale("CU-3", [{ batch: "I-3", product: "P-2", quantity: 5, unit_price: 800 }]);
        const { age_demand } = (await products(await person(OWNER))).body.data;
        assert.deepEqual(age_demand.map((r) => [r.age_band, r.oid, r.units, r.buyers]), [
            ["18_24", "P-1", 3, 1],
            ["18_24", "P-2", 1, 1],
            ["35_44", "P-1", 1, 1],
        ]);
    });
});

const CUSTOMERS = CONTEXTS.SALES + SUB_CONTEXTS.ANALYTICS + ROUTES.GET_SALES_ANALYTICS_CUSTOMERS;
const customers = (token, query = "") => h.call(`${CUSTOMERS}?date_from=2026-10-01&date_to=2026-10-31${query}`, { method: "GET", token });

describe("customers and places analytics", () => {
    const sale_to = async (customer, day, extra = {}) => {
        const oid = await order({ sold_on: at(day), lines: [{ batch: "I-1", quantity: 1, unit_price: 500 }], ...extra });
        await h.query("UPDATE orders SET customer_oid = $2 WHERE oid = $1", [oid, customer]);
        return oid;
    };

    beforeEach(async () => {
        await h.reset();
        await seed_catalogue();
        await seed_places();
        await h.query("TRUNCATE customers CASCADE");
        await h.query("INSERT INTO customers (oid, name, phone, phone_normalized) SELECT 'CU-' || n, 'Person ' || n, '0171100000' || n, '0171100000' || n FROM generate_series(1, 4) n");
    });

    it("refuses someone who may sell but not see analytics", async () => {
        const res = await customers(await person(["sales.pos.view"]));
        assert.equal(res.status, 403);
    });

    it("counts online buyers, sales and parcels that did not arrive by the district on the order", async () => {
        const kept = await delivered({ district: "BD-Dhaka" });
        await h.query("UPDATE orders SET customer_oid = 'CU-1', sold_on = $2 WHERE oid = $1", [kept, at("2026-10-06")]);
        await refused({ district: "BD-Dhaka" });
        const { places, insights } = (await customers(await person(OWNER))).body.data;
        const dhaka = places.find((p) => p.oid === "BD-Dhaka");
        assert.deepEqual([dhaka.customers, dhaka.sales, dhaka.dispatched, dhaka.failed], [1, 500, 2, 1]);
        assert.equal(insights.places.key, "top_district");
    });

    it("gives someone who sells only at the counter no places", async () => {
        const kept = await delivered();
        await h.query("UPDATE orders SET customer_oid = 'CU-1', sold_on = $2 WHERE oid = $1", [kept, at("2026-10-06")]);
        const { places } = (await customers(await person(["sales.analytics.view", "sales.pos.view"]))).body.data;
        assert.deepEqual(places, []);
    });

    it("narrows places to the category chosen", async () => {
        const kept = await delivered();
        await h.query("UPDATE orders SET customer_oid = 'CU-1', sold_on = $2 WHERE oid = $1", [kept, at("2026-10-06")]);
        const token = await person(OWNER);
        assert.equal((await customers(token, "&category_oid=C-1")).body.data.places.length, 1);
        assert.deepEqual((await customers(token, "&category_oid=C-2")).body.data.places, []);
    });

    it("tells new customers from returning ones and times the second purchase", async () => {
        await sale_to("CU-1", "2026-09-01");
        await sale_to("CU-1", "2026-10-11");
        await sale_to("CU-2", "2026-10-05");
        await sale_to("CU-2", "2026-10-15");
        const { repeat } = (await customers(await person(OWNER))).body.data;
        assert.deepEqual([repeat.customers, repeat.new_customers, repeat.bought_twice], [2, 1, 1]);
        // CU-1's second purchase came 40 days after the first, CU-2's after 10: the middle is 25.
        assert.equal(repeat.days_to_second, 25);
    });

    it("groups first purchases by month and counts who came back in the months after", async () => {
        await sale_to("CU-1", "2026-08-10");
        await sale_to("CU-1", "2026-10-03");
        await sale_to("CU-2", "2026-08-20");
        const { cohorts } = (await customers(await person(OWNER))).body.data;
        assert.deepEqual(cohorts, [{ cohort: "2026-08", customers: 2, returned: [{ month: 2, customers: 1 }] }]);
    });

    it("lists customers who bought twice or more and nothing in the last 60 days", async () => {
        await sale_to("CU-3", "2026-06-01");
        await sale_to("CU-3", "2026-07-01");
        await sale_to("CU-4", "2026-06-01");
        await sale_to("CU-4", "2026-10-20");
        const { win_back } = (await customers(await person(OWNER))).body.data;
        assert.deepEqual(win_back.map((c) => [c.name, c.sales, c.last_bought]), [["Person 3", 2, "2026-07-01"]]);
    });

    it("counts each customer who bought in the period once by age group, with those not recorded on their own", async () => {
        await h.query("UPDATE customers SET age_band = '25_34' WHERE oid IN ('CU-1', 'CU-2')");
        await h.query("UPDATE customers SET age_band = '45_plus' WHERE oid = 'CU-4'");
        await sale_to("CU-1", "2026-10-03");
        await sale_to("CU-1", "2026-10-09");
        await sale_to("CU-2", "2026-10-05");
        await sale_to("CU-3", "2026-10-06");
        await sale_to("CU-4", "2026-09-06");
        const { ages } = (await customers(await person(OWNER))).body.data;
        assert.deepEqual(ages.map((a) => [a.age_band, a.customers]).sort(), [
            [null, 1],
            ["25_34", 2],
        ]);
        assert.deepEqual((await customers(await person(OWNER), "&category_oid=C-2")).body.data.ages, [], "a category none of them bought from");
    });
});

describe("pre-orders and the counter on the overview", () => {
    beforeEach(async () => {
        await h.reset();
        await seed_catalogue();
        await h.query("TRUNCATE pre_orders CASCADE");
    });

    const booking = (status, created, advance = 0) => h.query("INSERT INTO pre_orders (oid, preorder_no, total_amount, advance_paid, status, created_on) VALUES ($1, $1, 1000, $2, $3, $4)", [uuidv4(), advance, status, created]);

    it("follows bookings taken in the period, and counts the advance held on every open booking", async () => {
        await booking("Converted", at("2026-10-03"));
        await booking("Cancelled", at("2026-10-04"));
        await booking("Confirmed", at("2026-10-05"), 300);
        // Taken before the period and still open: not booked in it, but its advance is held today.
        await booking("Pending", at("2026-09-10"), 200);
        const { pre_orders } = (await overview(await person([...OWNER, "sales.pre-order.view"]))).body.data;
        assert.deepEqual(pre_orders, { booked: 3, booked_value: 3000, converted: 1, cancelled: 1, open: 1, open_now: 2, advance_held: 500 });
    });

    it("leaves pre-orders out for someone who may not see them", async () => {
        const { pre_orders } = (await overview(await person(OWNER))).body.data;
        assert.equal(pre_orders, null);
    });

    it("sizes counter sales and counts the ones with no customer", async () => {
        // Customers first: clearing them would clear the orders that name them.
        await h.query("TRUNCATE customers CASCADE");
        await h.query("INSERT INTO customers (oid, name, phone, phone_normalized) VALUES ('CU-1', 'A', '01711000001', '01711000001')");
        await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 3, unit_price: 500, returned: 1 }] });
        const known = await order({ sold_on: at("2026-10-06"), lines: [{ batch: "I-1", quantity: 1, unit_price: 800 }] });
        await h.query("UPDATE orders SET customer_oid = 'CU-1' WHERE oid = $1", [known]);
        const { counter } = (await overview(await person(OWNER))).body.data;
        assert.deepEqual(counter, { sales: 2, units: 3, value: 1800, without_customer: 1 });
    });

    it("counts a cancelled pre-order's advance as held until its refund is recorded", async () => {
        await h.query("INSERT INTO pre_orders (oid, preorder_no, total_amount, advance_paid, advance_refund_due, status) VALUES ('PO-1', 'PO-1', 1000, 500, 500, 'Cancelled')");
        const { pre_orders } = (await overview(await person([...OWNER, "sales.pre-order.view"]))).body.data;
        assert.equal(pre_orders.advance_held, 500);
    });

    it("keeps the counter to the category chosen, and out of a source", async () => {
        await order({ sold_on: at("2026-10-05"), lines: [{ batch: "I-1", quantity: 1, unit_price: 1500 }, { batch: "I-3", product: "P-2", quantity: 1, unit_price: 500 }] });
        const token = await person(OWNER);
        assert.deepEqual((await overview(token, "&category_oid=C-2")).body.data.counter, { sales: 1, units: 1, value: 500, without_customer: 1 });
        await h.query("TRUNCATE order_source CASCADE");
        await h.query("INSERT INTO order_source (oid, platform, name) VALUES ('SRC-FB', 'Facebook', 'Main page')");
        assert.equal((await overview(token, "&source_oid=SRC-FB")).body.data.counter.sales, 0);
    });

    it("leaves the counter out for someone who sells only online", async () => {
        const { counter } = (await overview(await person(["sales.analytics.view", "sales.online.view"]))).body.data;
        assert.equal(counter, null);
    });
});
