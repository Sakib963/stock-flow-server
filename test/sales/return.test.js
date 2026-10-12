const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { DELIVERY, dispatch, deliver } = require("../support/delivery");
const { execute_transaction } = require("../../src/db/database");
const { openBatch } = require("../../src/routes/sales/utils/stock-movement");
const { reload_location_index } = require("../../src/routes/sales/location/utils/location-index");
const { invalidateSettings } = require("../../src/utils/settings-cache");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const ORDER = CONTEXTS.SALES + SUB_CONTEXTS.ORDER;
const RETURN = CONTEXTS.SALES + SUB_CONTEXTS.RETURN;
const PLACE = CONTEXTS.SALES + SUB_CONTEXTS.ONLINE + ROUTES.CREATE_ONLINE_ORDER;
const CHECKOUT = CONTEXTS.SALES + SUB_CONTEXTS.POS + ROUTES.CHECKOUT_POS_SALE;
const CREATE = RETURN + ROUTES.CREATE_RETURN;
const CONFIRM = RETURN + ROUTES.CONFIRM_RETURN;
const CANCEL = RETURN + ROUTES.CANCEL_RETURN;
const LIST = RETURN + ROUTES.GET_RETURN_LIST;
const FOR_ORDER = RETURN + ROUTES.GET_RETURNS_FOR_ORDER;
const DETAILS = RETURN + ROUTES.GET_RETURN_DETAILS;

const RETURNS = ["sales.return.view", "sales.return.create", "sales.return.confirm", "sales.return.cancel"];
const MANAGER = ["sales.pos.view", "sales.pos.create", "sales.online.view", "sales.online.create", "sales.order.view", "sales.order.confirm", "sales.order.dispatch", "sales.order.deliver", ...DELIVERY, ...RETURNS];
const USER = "owner@arithmalabs.test";
const SOURCE = uuidv4();
const MOHAMMADPUR = "T-Dhaka-Mohammadpur";

before(h.start);
after(h.stop);

let seq = 0;
const person = async (permissions = MANAGER) => (await h.sign_in(await h.seed_user({ email: `returns${++seq}@arithmalabs.test`, permissions }))).access;
const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });

let product;
const seed = async () => {
    await h.query("TRUNCATE stock_movement, stock_hold, product_stats, dispose_details, product_dispose, return_details, product_return, order_status_history, order_items, online_order, orders, customer_address, customers, order_source, inventory, product, sub_categories, categories, location_alias, area, post_office, thana, district, division, settings CASCADE");
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
const assert_balanced = async (oid) => {
    const held = await on_hand(oid);
    const rows = await movements(oid);
    assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), held);
    assert.equal(rows.at(-1).balance_after, held);
};
const order_row = async (oid) => (await h.query("SELECT o.status, o.payment_status, o.amount_paid::int, o.amount_refunded::int, o.refund_status, o.refund_due::int, o.sold_on, oo.delivery_status FROM orders o LEFT JOIN online_order oo ON oo.order_oid = o.oid WHERE o.oid = $1", [oid]))[0];
const stats = async () => (await h.query("SELECT total_sold::int, total_returned::int, total_damaged::int FROM product_stats WHERE product_oid = $1", [product]))[0];
const lines_of = async (order_oid) => h.query("SELECT oid FROM order_items WHERE order_oid = $1", [order_oid]);

const online = async (token, inventory_oid, { quantity = 2, payment_type = "COD", amount_paid } = {}) => {
    const oid = uuidv4();
    const body = { oid, customer: { phone: "01987654321", name: "Person A" }, address: { recipient_name: "Person A", address_line: "5/5, Gaznabi Road", district_oid: "BD-Dhaka", thana_oid: MOHAMMADPUR, area_text: "Gaznabi Road" }, source_oid: SOURCE, payment_type, payment_method: payment_type === "COD" ? undefined : "bkash", amount_paid, delivery_charge: 60, total_amount: 1450 * quantity + 60, lines: [{ inventory_oid, quantity, discount: 0 }] };
    const placed = await h.call(PLACE, { body, token });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    await h.call(ORDER + ROUTES.CONFIRM_ORDER, { body: { oid, confirmed_via: "PhoneCall" }, token });
    await dispatch(token, oid);
    return oid;
};
const delivered = async (token, inventory_oid, options) => {
    const oid = await online(token, inventory_oid, options);
    assert.equal((await deliver(token, oid)).status, 200);
    return oid;
};
const counter_sale = async (token, inventory_oid, { quantity = 2, payment_status = "paid", amount_paid } = {}) => {
    const oid = uuidv4();
    const body = { oid, payment_method: "cash", payment_status, amount_paid, customer: payment_status === "paid" ? undefined : { phone: "01711000000", name: "Person B" }, total_amount: 1450 * quantity, lines: [{ inventory_oid, quantity }] };
    const res = await h.call(CHECKOUT, { body, token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return oid;
};
const raise = async (token, order_oid, { quantity = 1, condition = "Good", reason = "changed_mind", refund_delivery_charge, oid = uuidv4() } = {}) => {
    const [line] = await lines_of(order_oid);
    return h.call(CREATE, { body: { oid, order_oid, return_reason: reason, refund_delivery_charge, items: [{ order_item_oid: line.oid, quantity, condition }] }, token });
};

describe("a customer return", () => {
    let token;
    let b1;
    beforeEach(async () => {
        await h.reset();
        await seed();
        token = await person();
        b1 = await batch(10);
    });

    it("is recorded Pending and moves nothing until it is confirmed", async () => {
        const order = await delivered(token, b1);
        const before = (await movements(b1)).length;
        const res = await raise(token, order);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.refund_amount, 1450);
        assert.equal((await movements(b1)).length, before);
        assert.equal(await on_hand(b1), 8);
        assert.equal((await order_row(order)).status, "Delivered");
        const [row] = await h.query("SELECT status, return_reason FROM product_return WHERE oid = $1", [res.body.data.return_oid]);
        assert.deepEqual(row, { status: "Pending", return_reason: "changed_mind" });
    });

    it("restocks a Good unit to the exact batch it was sold from on confirm, and owes the online customer the refund", async () => {
        const b2 = await batch(5);
        const order = await delivered(token, b1);
        const { return_oid } = (await raise(token, order)).body.data;
        const res = await h.call(CONFIRM, { body: { oid: return_oid }, token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(await on_hand(b1), 9);
        assert.equal(await on_hand(b2), 5, "never another batch of the same product");
        const last = (await movements(b1)).at(-1);
        assert.deepEqual(last, { reason: "returned", quantity: 1, balance_after: 9, source_oid: return_oid });
        await assert_balanced(b1);
        const row = await order_row(order);
        assert.deepEqual([row.status, row.refund_status, row.refund_due, row.amount_refunded], ["PartiallyReturned", "ToRefund", 1450, 0]);
        assert.deepEqual(await stats(), { total_sold: 2, total_returned: 1, total_damaged: 0 });
        assert.equal((await h.call(CONFIRM, { body: { oid: return_oid }, token })).status, 409, "confirmed once");
    });

    it("sends a unit found Damaged at confirm to an approved disposal, with no stock put back", async () => {
        const order = await delivered(token, b1);
        const { return_oid } = (await raise(token, order)).body.data;
        const [detail] = await h.query("SELECT oid FROM return_details WHERE return_oid = $1", [return_oid]);
        const before = (await movements(b1)).length;
        const res = await h.call(CONFIRM, { body: { oid: return_oid, conditions: [{ oid: detail.oid, condition: "Damaged" }] }, token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(await on_hand(b1), 8);
        assert.equal((await movements(b1)).length, before, "the unit already left at the sale, so no second deduction");
        const [dispose] = await h.query("SELECT status, total_dispose_quantity::int AS units FROM product_dispose WHERE oid = $1", [res.body.data.dispose_oid]);
        assert.deepEqual(dispose, { status: "Approved", units: 1 });
        assert.deepEqual(await stats(), { total_sold: 2, total_returned: 0, total_damaged: 1 });
        await assert_balanced(b1);
    });

    it("hands a counter refund back at once, by the method given", async () => {
        const order = await counter_sale(token, b1);
        const { return_oid } = (await raise(token, order)).body.data;
        assert.equal((await h.call(CONFIRM, { body: { oid: return_oid }, token })).status, 400, "the method is needed");
        const res = await h.call(CONFIRM, { body: { oid: return_oid, refund_method: "cash" }, token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const row = await order_row(order);
        assert.deepEqual([row.status, row.payment_status, row.amount_refunded, row.refund_status, row.refund_due], ["PartiallyReturned", "partially_refunded", 1450, "Refunded", 0]);
        const [history] = await h.query("SELECT reason FROM order_status_history WHERE order_oid = $1 AND kind = 'Refund'", [order]);
        assert.equal(history.reason, "1450 by cash");
        await assert_balanced(b1);
    });

    it("refunds only what was paid: the rest of an unpaid counter sale's return lowers what is owed", async () => {
        const order = await counter_sale(token, b1, { payment_status: "partially_paid", amount_paid: 1000 });
        const first = await raise(token, order);
        assert.deepEqual([first.body.data.refund_amount, first.body.data.due_reduction], [1000, 450]);
        const second = await raise(token, order);
        assert.deepEqual([second.body.data.refund_amount, second.body.data.due_reduction], [0, 1450], "the 1000 is already promised to the first");
    });

    it("never takes back more units than are still out, counting returns waiting to be confirmed", async () => {
        const order = await delivered(token, b1);
        assert.equal((await raise(token, order, { quantity: 2 })).status, 200);
        const res = await raise(token, order);
        assert.equal(res.status, 409);
        assert.match(res.body.message, /already on a return waiting/);
    });

    it("gives the delivery charge back only when the whole order comes back", async () => {
        const order = await delivered(token, b1);
        assert.equal((await raise(token, order, { quantity: 1, refund_delivery_charge: true })).status, 400);
        const full = await raise(token, order, { quantity: 2, refund_delivery_charge: true });
        assert.equal(full.body.data.refund_amount, 2960);
    });

    it("never gives the delivery charge back on what turned out to be a part return", async () => {
        const order = await delivered(token, b1);
        const first = (await raise(token, order, { quantity: 1 })).body.data;
        const second = await raise(token, order, { quantity: 1, refund_delivery_charge: true });
        assert.equal(second.status, 200, "the rest is on the first return, so this one completes the order");
        await h.call(CANCEL, { body: { oid: first.return_oid, reason: "Typed the wrong unit" }, token });
        const res = await h.call(CONFIRM, { body: { oid: second.body.data.return_oid }, token });
        assert.equal(res.status, 409);
        const row = await order_row(order);
        assert.deepEqual([row.status, row.refund_due], ["Delivered", 0]);
        assert.equal(await on_hand(b1), 8);
        await assert_balanced(b1);
    });

    it("records a repeated request once", async () => {
        const order = await delivered(token, b1);
        const oid = uuidv4();
        const [a, b] = [await raise(token, order, { oid }), await raise(token, order, { oid })];
        assert.deepEqual([a.status, b.status], [200, 200]);
        assert.equal(a.body.data.return_no, b.body.data.return_no);
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM product_return WHERE order_oid = $1", [order]))[0].n, 1);
    });

    it("lets only one of two confirms at the same moment move the stock", async () => {
        const order = await delivered(token, b1);
        const { return_oid } = (await raise(token, order)).body.data;
        const results = await Promise.all([h.call(CONFIRM, { body: { oid: return_oid }, token }), h.call(CONFIRM, { body: { oid: return_oid }, token })]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        assert.equal(await on_hand(b1), 9);
        await assert_balanced(b1);
    });

    it("cancels only while Pending, and never after the stock has moved", async () => {
        const order = await delivered(token, b1);
        const { return_oid } = (await raise(token, order)).body.data;
        assert.equal((await h.call(CANCEL, { body: { oid: return_oid, reason: "Typed the wrong order" }, token })).status, 200);
        assert.equal((await h.call(CONFIRM, { body: { oid: return_oid }, token })).status, 409);
        const again = (await raise(token, order)).body.data;
        await h.call(CONFIRM, { body: { oid: again.return_oid }, token });
        assert.equal((await h.call(CANCEL, { body: { oid: again.return_oid, reason: "Changed my mind" }, token })).status, 409);
        assert.match(again.return_no, /-R2$/, "a cancelled return keeps its number");
    });

    it("takes back a counter sale entered by mistake through Pending and Confirm, like any return", async () => {
        const order = await counter_sale(token, b1, { quantity: 1 });
        const res = await raise(token, order, { reason: "entered_by_mistake" });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        await h.call(CONFIRM, { body: { oid: res.body.data.return_oid, refund_method: "cash" }, token });
        const row = await order_row(order);
        assert.deepEqual([row.status, row.payment_status], ["Returned", "refunded"]);
        assert.ok(row.sold_on, "the sale happened and stays");
        await assert_balanced(b1);
    });

    it("refuses an order that is not a sale yet", async () => {
        const order = await online(token, b1);
        assert.equal((await raise(token, order)).status, 409);
    });
});

describe("a parcel that came back", () => {
    let token;
    let b1;
    beforeEach(async () => {
        await h.reset();
        await seed();
        token = await person();
        b1 = await batch(10);
    });

    const not_delivered = (oid, reason = "refused") => h.call(ORDER + ROUTES.MARK_ORDER_NOT_DELIVERED, { body: { oid, reason }, token });

    it("raises a Pending return of everything on it, moving nothing until the parcel is back", async () => {
        const order = await online(token, b1);
        const res = await not_delivered(order);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const [ret] = await h.query("SELECT status, return_reason, not_delivered_reason, refund_amount::int FROM product_return WHERE order_oid = $1", [order]);
        assert.deepEqual(ret, { status: "Pending", return_reason: "not_delivered", not_delivered_reason: "refused", refund_amount: 0 });
        const [units] = await h.query("SELECT SUM(return_quantity)::int AS n FROM return_details rd JOIN product_return pr ON pr.oid = rd.return_oid WHERE pr.order_oid = $1", [order]);
        assert.equal(units.n, 2);
        assert.equal(await on_hand(b1), 8);
    });

    it("restocks the exact batch on confirm, is Back in shop, and is never a sale or a return of one", async () => {
        const order = await online(token, b1);
        const { return_oid } = (await not_delivered(order)).body.data;
        const res = await h.call(CONFIRM, { body: { oid: return_oid }, token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(await on_hand(b1), 10);
        await assert_balanced(b1);
        const row = await order_row(order);
        assert.deepEqual([row.status, row.delivery_status, row.sold_on], ["Returned", "BackInShop", null]);
        assert.equal(await stats(), undefined, "nothing was sold, so nothing is counted returned");
    });

    it("gives an advance back less the delivery charge, which is kept", async () => {
        const order = await online(token, b1, { payment_type: "ADVANCE", amount_paid: 200 });
        const { return_oid } = (await not_delivered(order)).body.data;
        const [ret] = await h.query("SELECT refund_amount::int FROM product_return WHERE oid = $1", [return_oid]);
        assert.equal(ret.refund_amount, 140);
        await h.call(CONFIRM, { body: { oid: return_oid }, token });
        const row = await order_row(order);
        assert.deepEqual([row.refund_status, row.refund_due], ["ToRefund", 140]);
    });

    it("can be undone by cancelling its return: the parcel is with the courier again and can be delivered", async () => {
        const order = await online(token, b1);
        const { return_oid } = (await not_delivered(order, "wrong_address")).body.data;
        assert.equal((await h.call(CANCEL, { body: { oid: return_oid, reason: "The courier pressed the wrong button" }, token })).status, 200);
        assert.equal((await order_row(order)).delivery_status, "WithCourier");
        assert.equal((await deliver(token, order)).status, 200);
        await assert_balanced(b1);
    });
});

describe("who sees and changes returns", () => {
    let token;
    let b1;
    beforeEach(async () => {
        await h.reset();
        await seed();
        token = await person();
        b1 = await batch(10);
    });

    it("lists returns in the person's channels with what needs a hand", async () => {
        const order = await delivered(token, b1);
        await raise(token, order);
        const parcel = await online(token, b1);
        await h.call(ORDER + ROUTES.MARK_ORDER_NOT_DELIVERED, { body: { oid: parcel, reason: "refused" }, token });
        const res = await get(LIST, token, { include: "stats" });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.total, 2);
        assert.deepEqual(res.body.data.stats, { pending: 2, parcels_to_receive: 1, units_this_month: 0, damaged_this_month: 0 });
        const counter = await person(["sales.pos.view", "sales.return.view"]);
        assert.equal((await get(LIST, counter)).body.total, 0);
        const returns = await get(FOR_ORDER, token, { order_oid: order });
        assert.deepEqual(returns.body.data.returnable.map((r) => r.returnable), [1]);
    });

    it("keeps a return of an online order away from someone who sells only at the counter", async () => {
        const order = await delivered(token, b1);
        const { return_oid } = (await raise(token, order)).body.data;
        const counter = await person(["sales.pos.view", ...RETURNS]);
        assert.equal((await h.call(`${DETAILS}/${return_oid}`, { method: "GET", token: counter })).status, 404);
        assert.equal((await h.call(CONFIRM, { body: { oid: return_oid }, token: counter })).status, 404);
        assert.equal((await h.call(CANCEL, { body: { oid: return_oid, reason: "x" }, token: counter })).status, 404);
        assert.equal((await raise(counter, order)).status, 404);
    });

    it("needs each action's own permission", async () => {
        const order = await delivered(token, b1);
        const { return_oid } = (await raise(token, order)).body.data;
        const viewer = await person(["sales.online.view", "sales.return.view"]);
        assert.equal((await raise(viewer, order)).status, 403);
        assert.equal((await h.call(CONFIRM, { body: { oid: return_oid }, token: viewer })).status, 403);
        assert.equal((await h.call(CANCEL, { body: { oid: return_oid, reason: "x" }, token: viewer })).status, 403);
        const none = await person(["sales.online.view"]);
        assert.equal((await get(LIST, none)).status, 403);
        assert.equal((await get(FOR_ORDER, none, { order_oid: order })).status, 403);
        assert.equal((await h.call(`${DETAILS}/${return_oid}`, { method: "GET", token: none })).status, 403);
        assert.equal((await h.call(LIST, { method: "GET" })).status, 401);
    });
});
