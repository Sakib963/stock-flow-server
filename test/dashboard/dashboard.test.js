const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, ROUTES } = require("../../src/utils/constant");

const DASHBOARD = CONTEXTS.DASHBOARD + ROUTES.GET_DASHBOARD;
const VIEW = "dashboard.overview.view";

before(h.start);
after(h.stop);

const person = async (permissions) => {
    const user = await h.seed_user({ email: `p-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions: [VIEW, ...permissions] });
    return { ...user, token: (await h.sign_in(user)).access };
};
const dashboard = async (token, period = "today") => (await h.call(`${DASHBOARD}?period=${period}`, { method: "GET", token })).body.data;

const seed_product = async () => {
    const [category, sub_category, product] = [uuidv4(), uuidv4(), uuidv4()];
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, $1, $1, 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, $1, $1, $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, status) VALUES ($1, 'Lipstick', $2, $3, 'Active')", [product, category, sub_category]);
    return product;
};

// An online order that left Draft gets the Pending history row create-online-order writes, `placed_days_ago` before now.
const seed_order = async ({ channel, status, created_by, sold = false, lines = [], created_days_ago = 0, placed_days_ago = 0 }) => {
    const oid = uuidv4();
    const total = lines.reduce((sum, l) => sum + (l.price - (l.discount ?? 0)) * l.quantity, 0);
    await h.query(`INSERT INTO orders (oid, invoice_no, channel, status, total_amount, created_by, created_on, sold_on) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP - make_interval(days => $7), ${sold ? "CURRENT_TIMESTAMP" : "NULL"})`, [oid, oid.slice(0, 12), channel, status, total, created_by, created_days_ago]);
    for (const l of lines) {
        await h.query("INSERT INTO order_items (oid, order_oid, product_oid, product_name, quantity, unit_price, discount, total, returned_qty) VALUES ($1, $2, $3, 'Lipstick', $4, $5, $6, $7, $8)", [uuidv4(), oid, l.product, l.quantity, l.price, l.discount ?? 0, (l.price - (l.discount ?? 0)) * l.quantity, l.returned ?? 0]);
    }
    if (channel === "ONLINE" && status !== "Draft") {
        await h.query("INSERT INTO order_status_history (oid, order_oid, from_status, to_status, performed_by, performed_on, kind) VALUES ($1, $2, 'Draft', 'Pending', $3, CURRENT_TIMESTAMP - make_interval(days => $4), 'Order')", [uuidv4(), oid, created_by, placed_days_ago]);
    }
    return oid;
};

describe("dashboard", () => {
    beforeEach(async () => {
        await h.reset();
        await h.query("TRUNCATE orders CASCADE");
    });

    it("is closed to someone without the dashboard", async () => {
        const user = await h.seed_user({ email: "nobody@arithmalabs.test", permissions: ["configuration.category.view"] });
        const token = (await h.sign_in(user)).access;
        assert.equal((await h.call(DASHBOARD, { method: "GET", token })).status, 403);
    });

    it("shows nothing but the greeting to someone who holds no feature it summarises", async () => {
        const viewer = await person([]);
        const data = await dashboard(viewer.token);
        assert.deepEqual([data.for_you, data.attention], [null, null]);
        assert.equal(data.period.key, "today");
    });

    it("refuses a period it does not know", async () => {
        const viewer = await person([]);
        assert.equal((await h.call(`${DASHBOARD}?period=year`, { method: "GET", token: viewer.token })).status, 400);
    });

    it("lists waiting orders only to someone who may act on them, through their own channels", async () => {
        await seed_order({ channel: "ONLINE", status: "Pending", created_by: "x@arithmalabs.test" });
        await seed_order({ channel: "ONLINE", status: "Pending", created_by: "x@arithmalabs.test" });

        const moderator = await person(["sales.online.view", "sales.order.view", "sales.order.confirm"]);
        const waiting = (await dashboard(moderator.token)).attention.find((row) => row.key === "orders_to_confirm");
        assert.equal(waiting?.count, 2);

        const looker = await person(["sales.online.view", "sales.order.view"]);
        assert.equal((await dashboard(looker.token)).attention, null, "seeing orders is not confirming them");

        const counter_only = await person(["sales.pos.view", "sales.order.view", "sales.order.confirm"]);
        assert.equal((await dashboard(counter_only.token)).attention.length, 0, "online orders are not on a counter person's channels");
    });

    it("leaves out a kind with nothing waiting", async () => {
        const manager = await person(["inventory.purchase-order.view", "inventory.purchase-order.approve"]);
        assert.equal((await dashboard(manager.token)).attention.length, 0);
    });

    it("shows a counter person their own kept sales and parked carts, never someone else's", async () => {
        const product = await seed_product();
        const cashier = await person(["sales.pos.view", "sales.pos.create"]);
        await seed_order({ channel: "POS", status: "Purchased", created_by: cashier.email, sold: true, lines: [{ product, quantity: 2, price: 100, discount: 10 }] });
        await seed_order({ channel: "POS", status: "Purchased", created_by: "other@arithmalabs.test", sold: true, lines: [{ product, quantity: 5, price: 100 }] });
        await seed_order({ channel: "POS", status: "Draft", created_by: cashier.email });

        const mine = (await dashboard(cashier.token)).for_you;
        assert.deepEqual([mine.counter.sales, mine.counter.orders], [180, 1], "line total is (price - discount) * quantity");
        assert.equal(mine.drafts.parked, 1);
        assert.equal(mine.online, null, "no online figure without online orders");
    });

    it("shows the business figures only with sales analytics, and the same kept sales as the analytics page", async () => {
        const product = await seed_product();
        await seed_order({ channel: "POS", status: "Purchased", created_by: "a@arithmalabs.test", sold: true, lines: [{ product, quantity: 3, price: 200, discount: 20 }] });
        await seed_order({ channel: "POS", status: "Purchased", created_by: "b@arithmalabs.test", sold: true, lines: [{ product, quantity: 1, price: 500 }] });

        const cashier = await person(["sales.pos.view", "sales.pos.create"]);
        assert.equal((await dashboard(cashier.token)).business, null, "a counter person never sees the business's money");

        const owner = await person(["sales.pos.view", "sales.analytics.view"]);
        const month = await dashboard(owner.token, "month");
        assert.deepEqual([month.business.current.sales, month.business.current.orders, month.business.current.average], [1040, 2, 520]);
        assert.equal(month.business.top[0].units, 4);

        const overview = (await h.call(`${CONTEXTS.SALES}/analytics${ROUTES.GET_SALES_ANALYTICS_OVERVIEW}?date_from=${month.period.date_from}&date_to=${month.period.date_to}`, { method: "GET", token: owner.token })).body.data;
        assert.equal(overview.tiles.sales.current, month.business.current.sales, "the dashboard and sales analytics agree");
        assert.deepEqual((await dashboard(owner.token, "today")).business.daily, [], "one day has no chart");
    });

    it("shows stock value only with the stock value permission", async () => {
        const looker = await person(["inventory.overview.view"]);
        assert.equal((await dashboard(looker.token)).stock, null);
        const owner = await person(["inventory.overview.view", "inventory.stock-value.view"]);
        const stock = (await dashboard(owner.token)).stock;
        assert.deepEqual(Object.keys(stock).sort(), ["expected_revenue", "profit_full", "stock_value", "unpriced_batches"]);
    });

    it("counts only realized counter sales, less units on confirmed returns", async () => {
        const product = await seed_product();
        const cashier = await person(["sales.pos.view", "sales.pos.create"]);
        await seed_order({ channel: "POS", status: "Confirmed", created_by: cashier.email, lines: [{ product, quantity: 9, price: 100 }] });
        await seed_order({ channel: "POS", status: "PartiallyReturned", created_by: cashier.email, sold: true, lines: [{ product, quantity: 3, price: 100, returned: 1 }] });

        const mine = (await dashboard(cashier.token)).for_you.counter;
        assert.deepEqual([mine.sales, mine.orders], [200, 1], "the unsold order counts nothing and the returned unit comes off");
    });

    it("dates an online order by the day it was placed, not the day its draft was saved", async () => {
        const moderator = await person(["sales.online.view", "sales.online.create"]);
        await seed_order({ channel: "ONLINE", status: "Pending", created_by: moderator.email, created_days_ago: 1, placed_days_ago: 0 });
        await seed_order({ channel: "ONLINE", status: "Returned", created_by: moderator.email, sold: true });

        const today = (await dashboard(moderator.token)).for_you.online;
        assert.deepEqual([today.entered, today.sold], [2, 0], "placed today though saved yesterday; returned in full is not a kept sale");
    });

    it("lists an action only with the view of the list it opens", async () => {
        await seed_order({ channel: "ONLINE", status: "Pending", created_by: "x@arithmalabs.test" });
        const confirmer = await person(["sales.online.view", "sales.order.confirm"]);
        assert.equal((await dashboard(confirmer.token)).attention, null);
    });

    it("counts the online orders a moderator entered and how many became sales", async () => {
        const moderator = await person(["sales.online.view", "sales.online.create"]);
        await seed_order({ channel: "ONLINE", status: "Delivered", created_by: moderator.email, sold: true });
        await seed_order({ channel: "ONLINE", status: "Pending", created_by: moderator.email });
        await seed_order({ channel: "ONLINE", status: "Draft", created_by: moderator.email });

        const mine = (await dashboard(moderator.token, "week")).for_you;
        assert.deepEqual([mine.online.entered, mine.online.sold, mine.drafts.online], [2, 1, 1]);
        assert.equal(mine.counter, null);
    });
});
