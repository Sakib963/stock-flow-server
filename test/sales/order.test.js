const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { execute_transaction } = require("../../src/db/database");
const { openBatch } = require("../../src/routes/sales/utils/stock-movement");
const { reload_location_index } = require("../../src/routes/sales/location/utils/location-index");
const { invalidateSettings } = require("../../src/utils/settings-cache");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const ORDER = CONTEXTS.SALES + SUB_CONTEXTS.ORDER;
const CREATE = CONTEXTS.SALES + SUB_CONTEXTS.ONLINE + ROUTES.CREATE_ONLINE_ORDER;
const SAVE_DRAFT = CONTEXTS.SALES + SUB_CONTEXTS.ONLINE + ROUTES.SAVE_ONLINE_DRAFT;
const LIST = ORDER + ROUTES.GET_ORDER_LIST;
const DETAILS = ORDER + ROUTES.GET_ORDER_DETAILS;
const CONFIRM = ORDER + ROUTES.CONFIRM_ORDER;
const CANCEL = ORDER + ROUTES.CANCEL_ORDER;
const PACKED = ORDER + ROUTES.MARK_ORDER_PACKED;
const DISPATCH = ORDER + ROUTES.DISPATCH_ORDER;
const DELIVER = ORDER + ROUTES.DELIVER_ORDER;
const NOT_DELIVERED = ORDER + ROUTES.MARK_ORDER_NOT_DELIVERED;

const MANAGER = ["sales.online.view", "sales.online.create", "sales.order.view", "sales.order.confirm", "sales.order.cancel", "sales.order.dispatch", "sales.order.deliver"];
const USER = "owner@arithmalabs.test";
const SOURCE = uuidv4();
const MOHAMMADPUR = "T-Dhaka-Mohammadpur";

before(h.start);
after(h.stop);

let seq = 0;
const person = async (permissions = MANAGER) => (await h.sign_in(await h.seed_user({ email: `manager${++seq}@arithmalabs.test`, permissions }))).access;
const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });

let product;
const seed = async () => {
    await h.query("TRUNCATE stock_movement, stock_hold, product_stats, order_status_history, order_items, online_order, orders, customer_address, customers, order_source, inventory, product, sub_categories, categories, location_alias, area, post_office, thana, district, division, settings CASCADE");
    await h.query("INSERT INTO division (oid, name_en, name_bn) VALUES ('BD-Dhaka-Division', 'Dhaka Division', 'ঢাকা বিভাগ')");
    await h.query("INSERT INTO district (oid, name_en, name_bn, division_oid) VALUES ('BD-Dhaka', 'Dhaka', 'ঢাকা', 'BD-Dhaka-Division')");
    await h.query("INSERT INTO thana (oid, name_en, name_bn, type, postal_code, district_oid) VALUES ($1, 'Mohammadpur', 'মোহাম্মদপুর', 'Thana', '1207', 'BD-Dhaka')", [MOHAMMADPUR]);
    await h.query("INSERT INTO settings (oid, name, delivery_charge_inside, delivery_charge_outside, home_district_oid) VALUES ($1, 'A boutique', 60, 120, 'BD-Dhaka')", [uuidv4()]);
    await h.query("INSERT INTO order_source (oid, platform, name, status) VALUES ($1, 'Facebook', 'Facebook page', 'Active')", [SOURCE]);
    invalidateSettings();
    await reload_location_index();
    const category = uuidv4();
    const sub_category = uuidv4();
    product = uuidv4();
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Tops', 'TOPS', $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Floral kurti', 'KURTI-38', $2, $3, 5, 'Active')", [product, category, sub_category]);
};

const batch = async (quantity) => {
    const oid = uuidv4();
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, selling_price, maximum_discount, intended_use, status) VALUES ($1, $2, $3, $4, $4, 700, 1450, 100, 'for_sale', 'ready_for_sale')", [oid, `B-${oid.slice(0, 4)}`, product, quantity]);
    await execute_transaction((tx) => openBatch(tx, { inventory_oid: oid, quantity, reason: "opening_stock", source_oid: oid, user_id: USER }));
    return oid;
};

const on_hand = async (oid) => (await h.query("SELECT quantity_available::int AS q FROM inventory WHERE oid = $1", [oid]))[0].q;
const movements = (oid) => h.query("SELECT reason, quantity, balance_after, source_oid FROM stock_movement WHERE inventory_oid = $1 ORDER BY created_on, oid", [oid]);
const holds = (order_oid) => h.query("SELECT quantity::int, status FROM stock_hold WHERE order_oid = $1", [order_oid]);
const assert_balanced = async (oid) => {
    const held = await on_hand(oid);
    const rows = await movements(oid);
    assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), held);
    assert.equal(rows.at(-1).balance_after, held);
};
const order_row = async (oid) => (await h.query("SELECT o.status, o.payment_status, o.amount_paid::int, o.refund_status, o.refund_due::int, o.sold_on, o.dispatched_on, oo.delivery_status FROM orders o JOIN online_order oo ON oo.order_oid = o.oid WHERE o.oid = $1", [oid]))[0];

const place = async (token, inventory_oid, { quantity = 2, payment_type = "COD", amount_paid, phone = "01987654321" } = {}) => {
    const body = { oid: uuidv4(), customer: { phone, name: "Person A" }, address: { recipient_name: "Person A", address_line: "5/5, Gaznabi Road", district_oid: "BD-Dhaka", thana_oid: MOHAMMADPUR, area_text: "Gaznabi Road" }, source_oid: SOURCE, payment_type, payment_method: payment_type === "COD" ? undefined : "bkash", amount_paid, delivery_charge: 60, total_amount: 1450 * quantity + 60, lines: [{ inventory_oid, quantity, discount: 0 }] };
    const res = await h.call(CREATE, { body, token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return body.oid;
};

describe("the orders list and record", () => {
    let token;
    let b1;
    beforeEach(async () => {
        await h.reset();
        await seed();
        token = await person();
        b1 = await batch(10);
    });

    it("lists only the person's channels, never a draft, and narrows to their own orders", async () => {
        const mine = await place(token, b1);
        const other = await person();
        await place(other, b1, { quantity: 1, phone: "01711000000" });
        await h.call(SAVE_DRAFT, { body: { oid: uuidv4(), lines: [{ inventory_oid: b1, quantity: 1 }] }, token });

        const all = await get(LIST, token, { include: "stats" });
        assert.equal(all.status, 200, JSON.stringify(all.body));
        assert.equal(all.body.total, 2);
        assert.equal(all.body.data.stats.pending, 2);
        const own = await get(LIST, token, { mine: "true" });
        assert.deepEqual(own.body.data.rows.map((row) => row.oid), [mine]);

        const counter = await person(["sales.pos.view", "sales.order.view"]);
        assert.equal((await get(LIST, counter)).body.total, 0);
        assert.equal((await get(DETAILS, counter, { oid: mine })).status, 404);
    });

    it("reads an order with its lines, where it goes and its timeline", async () => {
        const oid = await place(token, b1);
        const res = await get(DETAILS, token, { oid });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.items[0].quantity, 2);
        assert.equal(res.body.data.online.thana_name_en, "Mohammadpur");
        assert.equal(res.body.data.online.source_name, "Facebook page");
        assert.deepEqual(res.body.data.status_history.map((row) => row.to_status), ["Pending"]);
    });

    it("needs the orders permission to list or read", async () => {
        const without = await person(["sales.online.view", "sales.online.create"]);
        assert.equal((await get(LIST, without)).status, 403);
        assert.equal((await h.call(LIST, { method: "GET" })).status, 401);
    });
});

describe("an online order's lifecycle", () => {
    let token;
    let b1;
    beforeEach(async () => {
        await h.reset();
        await seed();
        token = await person();
        b1 = await batch(10);
    });

    it("confirms once, moves no stock, sets Preparing and learns the area", async () => {
        const oid = await place(token, b1);
        const res = await h.call(CONFIRM, { body: { oid, confirmed_via: "PhoneCall" }, token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.deepEqual([(await order_row(oid)).status, (await order_row(oid)).delivery_status], ["Confirmed", "Preparing"]);
        assert.equal((await movements(b1)).length, 1, "confirming moves nothing");
        const [area] = await h.query("SELECT times_used FROM area WHERE thana_oid = $1 AND kind = 'Learned'", [MOHAMMADPUR]);
        assert.equal(area.times_used, 1);
        assert.equal((await h.call(CONFIRM, { body: { oid, confirmed_via: "PhoneCall" }, token })).status, 409);
        const activity = await h.query("SELECT title FROM activity_log WHERE reference_oid = $1", [oid]);
        assert.ok(activity.some((a) => a.title === "Online order confirmed"));
    });

    it("cancels before dispatch with a reason, releases the holds without a movement, and owes back an advance", async () => {
        const oid = await place(token, b1, { payment_type: "ADVANCE", amount_paid: 200 });
        assert.equal((await h.call(CANCEL, { body: { oid, reason_code: "other" }, token })).status, 400, "Other needs a note");
        const res = await h.call(CANCEL, { body: { oid, reason_code: "fake_order" }, token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const row = await order_row(oid);
        assert.deepEqual([row.status, row.refund_status, row.refund_due], ["Cancelled", "ToRefund", 200]);
        assert.deepEqual(await holds(oid), [{ quantity: 2, status: "Released" }]);
        assert.equal(await on_hand(b1), 10);
        assert.equal((await movements(b1)).length, 1);
        await assert_balanced(b1);
    });

    it("dispatches once: the held units leave the shelf with a dispatched movement, and it can no longer be cancelled", async () => {
        const oid = await place(token, b1);
        await h.call(CONFIRM, { body: { oid, confirmed_via: "Message" }, token });
        assert.equal((await h.call(PACKED, { body: { oid }, token })).status, 200);
        const results = await Promise.all([1, 2].map(() => h.call(DISPATCH, { body: { oid, courier: "Pathao", consignment_no: "PX-1" }, token })));
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);

        assert.equal(await on_hand(b1), 8);
        const moved = await movements(b1);
        assert.deepEqual(moved.slice(1).map((m) => [m.reason, m.quantity, m.balance_after, m.source_oid]), [["dispatched", -2, 8, oid]]);
        assert.deepEqual(await holds(oid), [{ quantity: 2, status: "Deducted" }]);
        assert.equal((await order_row(oid)).delivery_status, "WithCourier");
        assert.equal((await h.call(CANCEL, { body: { oid, reason_code: "changed_mind" }, token })).status, 409);
        await assert_balanced(b1);
    });

    it("delivers a dispatched order as a sale: sold_on set once, the courier's collection paid, units counted sold", async () => {
        const oid = await place(token, b1, { payment_type: "ADVANCE", amount_paid: 200 });
        assert.equal((await h.call(DELIVER, { body: { oid }, token })).status, 409, "not before dispatch");
        await h.call(CONFIRM, { body: { oid, confirmed_via: "AdvanceReceived" }, token });
        await h.call(DISPATCH, { body: { oid, courier: "Steadfast" }, token });
        const res = await h.call(DELIVER, { body: { oid }, token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const row = await order_row(oid);
        assert.deepEqual([row.status, row.payment_status, row.amount_paid, row.delivery_status], ["Delivered", "paid", 2960, "Delivered"]);
        assert.ok(row.sold_on);
        const [stats] = await h.query("SELECT total_sold::int FROM product_stats WHERE product_oid = $1", [product]);
        assert.equal(stats.total_sold, 2);
        assert.equal((await h.call(DELIVER, { body: { oid }, token })).status, 409);
        assert.equal((await movements(b1)).length, 2, "delivering moves nothing more");
        await assert_balanced(b1);
    });

    it("records a parcel not delivered as Failed, never a sale, with nothing moved back yet", async () => {
        const oid = await place(token, b1);
        await h.call(CONFIRM, { body: { oid, confirmed_via: "PhoneCall" }, token });
        await h.call(DISPATCH, { body: { oid, courier: "RedX" }, token });
        const res = await h.call(NOT_DELIVERED, { body: { oid, reason: "refused" }, token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const row = await order_row(oid);
        assert.deepEqual([row.status, row.delivery_status, row.sold_on], ["Confirmed", "Failed", null]);
        assert.equal((await h.call(DELIVER, { body: { oid }, token })).status, 409);
        assert.equal(await on_hand(b1), 8);
        await assert_balanced(b1);
    });

    it("refuses each action to someone without its permission, and every action without sign in", async () => {
        const oid = await place(token, b1);
        const viewer = await person(["sales.online.view", "sales.order.view"]);
        for (const [route, body] of [[CONFIRM, { oid, confirmed_via: "PhoneCall" }], [CANCEL, { oid, reason_code: "duplicate" }], [PACKED, { oid }], [DISPATCH, { oid, courier: "Pathao" }], [DELIVER, { oid }], [NOT_DELIVERED, { oid, reason: "refused" }]]) {
            assert.equal((await h.call(route, { body, token: viewer })).status, 403, route);
            assert.equal((await h.call(route, { body })).status, 401, route);
        }
        assert.equal((await order_row(oid)).status, "Pending");
    });
});
