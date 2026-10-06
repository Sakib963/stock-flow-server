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
const REFUND = ORDER + ROUTES.RECORD_ORDER_REFUND;
const EDIT = CONTEXTS.SALES + SUB_CONTEXTS.ONLINE + ROUTES.EDIT_ONLINE_ORDER;
const FOR_EDIT = CONTEXTS.SALES + SUB_CONTEXTS.ONLINE + ROUTES.GET_ONLINE_ORDER_FOR_EDIT;
const HISTORY = CONTEXTS.SALES + SUB_CONTEXTS.ORDER_HISTORY;
const SALESPERSON = ["sales.online.view", "sales.online.create", "sales.order-history.view", "sales.order-history.confirm", "sales.order-history.cancel"];

const MANAGER = ["sales.online.view", "sales.online.create", "sales.order.view", "sales.order.confirm", "sales.order.cancel", "sales.order.dispatch", "sales.order.deliver", "sales.order.refund", "sales.order.edit"];
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
const order_row = async (oid) => (await h.query("SELECT o.status, o.payment_status, o.amount_paid::int, o.refund_status, o.refund_due::int, o.amount_refunded::int, o.sold_on, o.dispatched_on, oo.delivery_status FROM orders o JOIN online_order oo ON oo.order_oid = o.oid WHERE o.oid = $1", [oid]))[0];

const order_body = (inventory_oid, { oid = uuidv4(), quantity = 2, payment_type = "COD", amount_paid, phone = "01987654321" } = {}) => ({ oid, customer: { phone, name: "Person A" }, address: { recipient_name: "Person A", address_line: "5/5, Gaznabi Road", district_oid: "BD-Dhaka", thana_oid: MOHAMMADPUR, area_text: "Gaznabi Road" }, source_oid: SOURCE, payment_type, payment_method: payment_type === "COD" ? undefined : "bkash", amount_paid, delivery_charge: 60, total_amount: 1450 * quantity + 60, lines: [{ inventory_oid, quantity, discount: 0 }] });

const place = async (token, inventory_oid, options = {}) => {
    const body = order_body(inventory_oid, options);
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

    it("lists only the person's channels and never a draft", async () => {
        await place(token, b1);
        await place(await person(), b1, { quantity: 1, phone: "01711000000" });
        await h.call(SAVE_DRAFT, { body: { oid: uuidv4(), lines: [{ inventory_oid: b1, quantity: 1 }] }, token });
        const all = await get(LIST, token, { include: "stats" });
        assert.equal(all.status, 200, JSON.stringify(all.body));
        assert.equal(all.body.total, 2);
        assert.equal(all.body.data.stats.pending, 2);
        const counter = await person(["sales.pos.view", "sales.order.view"]);
        assert.equal((await get(LIST, counter)).body.total, 0);
    });

    it("shows a salesperson's order history as only the orders they placed, and lets them confirm and cancel only those", async () => {
        const seller = await person(SALESPERSON);
        const mine = await place(seller, b1);
        const theirs = await place(token, b1, { quantity: 1, phone: "01711000000" });
        const list = await get(HISTORY + ROUTES.GET_ORDER_LIST, seller);
        assert.equal(list.status, 200, JSON.stringify(list.body));
        assert.deepEqual(list.body.data.rows.map((row) => row.oid), [mine]);
        assert.equal((await get(HISTORY + ROUTES.GET_ORDER_DETAILS, seller, { oid: theirs })).status, 404);
        assert.equal((await h.call(HISTORY + ROUTES.CONFIRM_ORDER, { body: { oid: theirs, confirmed_via: "PhoneCall" }, token: seller })).status, 404);
        assert.equal((await h.call(HISTORY + ROUTES.CONFIRM_ORDER, { body: { oid: mine, confirmed_via: "PhoneCall" }, token: seller })).status, 200);
        assert.equal((await h.call(HISTORY + ROUTES.CANCEL_ORDER, { body: { oid: mine, reason_code: "changed_mind" }, token: seller })).status, 200);
        assert.equal((await get(LIST, seller)).status, 403, "the bigger Orders page is not theirs");
        assert.equal((await h.call(DISPATCH, { body: { oid: theirs, courier: "Pathao" }, token: seller })).status, 403);
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

    it("records a refund owed on a cancelled advance, part then the rest, and moves payment status with it", async () => {
        const oid = await place(token, b1, { payment_type: "ADVANCE", amount_paid: 200 });
        await h.call(CANCEL, { body: { oid, reason_code: "changed_mind" }, token });
        assert.equal((await h.call(REFUND, { body: { oid, amount: 250, method: "bkash" }, token })).status, 400, "more than is owed");
        assert.equal((await h.call(REFUND, { body: { oid, amount: 50, method: "other" }, token })).status, 400, "Other needs a note");

        assert.equal((await h.call(REFUND, { body: { oid, amount: 50, method: "bkash", note: "TrxID 8K2" }, token })).status, 200);
        let row = await order_row(oid);
        assert.deepEqual([row.refund_status, row.refund_due, row.amount_refunded, row.payment_status], ["ToRefund", 150, 50, "partially_refunded"]);

        assert.equal((await h.call(REFUND, { body: { oid, amount: 150, method: "cash" }, token })).status, 200);
        row = await order_row(oid);
        assert.deepEqual([row.refund_status, row.refund_due, row.amount_refunded, row.payment_status], ["Refunded", 0, 200, "refunded"]);
        assert.equal((await h.call(REFUND, { body: { oid, amount: 1, method: "cash" }, token })).status, 409, "nothing left owed");

        const history = await h.query("SELECT to_status, reason FROM order_status_history WHERE order_oid = $1 AND kind = 'Refund' ORDER BY performed_on", [oid]);
        assert.deepEqual(history.map((e) => e.to_status), ["ToRefund", "ToRefund", "Refunded"]);
        assert.equal(history[1].reason, "50 by bkash: TrxID 8K2");
        assert.equal((await h.query("SELECT 1 FROM activity_log WHERE reference_oid = $1 AND title = 'Refund recorded'", [oid])).length, 2);
        assert.equal((await movements(b1)).length, 1, "a refund moves no stock");
    });

    it("refuses a refund on an order that owes nothing back", async () => {
        const oid = await place(token, b1);
        await h.call(CANCEL, { body: { oid, reason_code: "duplicate" }, token });
        assert.equal((await h.call(REFUND, { body: { oid, amount: 10, method: "cash" }, token })).status, 409);
        assert.equal((await order_row(oid)).payment_status, "unpaid");
    });

    it("never refunds twice when the same refund is pressed at once", async () => {
        const oid = await place(token, b1, { payment_type: "ADVANCE", amount_paid: 200 });
        await h.call(CANCEL, { body: { oid, reason_code: "changed_mind" }, token });
        const both = await Promise.all([1, 2].map(() => h.call(REFUND, { body: { oid, amount: 200, method: "cash" }, token })));
        assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
        assert.equal((await order_row(oid)).amount_refunded, 200);
    });

    it("edits a Pending order: the old holds released and the new lines held, same invoice and tracking link, no movement", async () => {
        const oid = await place(token, b1);
        const [before] = await h.query("SELECT invoice_no, tracking_token FROM orders WHERE oid = $1", [oid]);
        const res = await h.call(EDIT, { body: order_body(b1, { oid, quantity: 5 }), token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.deepEqual((await holds(oid)).sort((a, b) => a.status.localeCompare(b.status)), [{ quantity: 5, status: "Active" }, { quantity: 2, status: "Released" }]);
        const [after] = await h.query("SELECT invoice_no, tracking_token, total_amount::int, status FROM orders WHERE oid = $1", [oid]);
        assert.deepEqual(after, { ...before, total_amount: 1450 * 5 + 60, status: "Pending" });
        assert.equal((await h.query("SELECT 1 FROM order_items WHERE order_oid = $1", [oid])).length, 1);
        assert.equal((await movements(b1)).length, 1, "editing moves nothing on the shelf");
        await assert_balanced(b1);
        assert.ok((await h.query("SELECT reason FROM order_status_history WHERE order_oid = $1", [oid])).some((e) => e.reason === "Online order edited"));
    });

    it("lets an edit take the units its own order held, and no more than the shelf has", async () => {
        const oid = await place(token, b1, { quantity: 8 });
        const read = await get(FOR_EDIT, token, { oid });
        assert.equal(read.status, 200, JSON.stringify(read.body));
        assert.deepEqual([read.body.data.lines[0].quantity, read.body.data.lines[0].sellable], [8, 10], "its own held units count as free for it");
        assert.equal((await h.call(EDIT, { body: order_body(b1, { oid, quantity: 10 }), token })).status, 200, "its own 8 count as sellable");
        assert.equal((await h.call(EDIT, { body: order_body(b1, { oid, quantity: 11 }), token })).status, 409);
        assert.deepEqual((await holds(oid)).filter((x) => x.status === "Active"), [{ quantity: 10, status: "Active" }], "a refused edit changes nothing");
    });

    it("refuses to edit an order once it is confirmed, and without the edit permission", async () => {
        const oid = await place(token, b1);
        const seller = await person(["sales.online.view", "sales.online.create", "sales.order.view"]);
        assert.equal((await h.call(EDIT, { body: order_body(b1, { oid, quantity: 3 }), token: seller })).status, 403);
        await h.call(CONFIRM, { body: { oid, confirmed_via: "PhoneCall" }, token });
        assert.equal((await h.call(EDIT, { body: order_body(b1, { oid, quantity: 3 }), token })).status, 409);
        assert.equal((await get(FOR_EDIT, token, { oid })).status, 409);
        assert.deepEqual((await holds(oid)).filter((x) => x.status === "Active"), [{ quantity: 2, status: "Active" }]);
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

    it("never counts a parcel as sold when Deliver and Not delivered are pressed at once", async () => {
        const oid = await place(token, b1);
        await h.call(CONFIRM, { body: { oid, confirmed_via: "PhoneCall" }, token });
        await h.call(DISPATCH, { body: { oid, courier: "Pathao" }, token });
        const [delivered, failed] = await Promise.all([h.call(DELIVER, { body: { oid }, token }), h.call(NOT_DELIVERED, { body: { oid, reason: "refused" }, token })]);
        assert.deepEqual([delivered.status, failed.status].sort(), [200, 409]);
        const row = await order_row(oid);
        if (failed.status === 200) assert.deepEqual([row.delivery_status, row.sold_on, row.status], ["Failed", null, "Confirmed"]);
        else assert.deepEqual([row.delivery_status, row.status], ["Delivered", "Delivered"]);
    });

    it("records whether an order was Pending or Confirmed when it was cancelled", async () => {
        const oid = await place(token, b1);
        await h.call(CONFIRM, { body: { oid, confirmed_via: "PhoneCall" }, token });
        await h.call(CANCEL, { body: { oid, reason_code: "duplicate" }, token });
        const [row] = await h.query("SELECT from_status FROM order_status_history WHERE order_oid = $1 AND to_status = 'Cancelled'", [oid]);
        assert.equal(row.from_status, "Confirmed");
    });

    it("refuses an action to someone who does not sell online, even with its permission", async () => {
        const oid = await place(token, b1);
        const counter = await person(["sales.pos.view", "sales.order.view", "sales.order.cancel"]);
        assert.equal((await h.call(CANCEL, { body: { oid, reason_code: "duplicate" }, token: counter })).status, 403);
        assert.equal((await order_row(oid)).status, "Pending");
    });

    it("refuses each action to someone without its permission, and every action without sign in", async () => {
        const oid = await place(token, b1);
        const viewer = await person(["sales.online.view", "sales.order.view"]);
        for (const [route, body] of [[CONFIRM, { oid, confirmed_via: "PhoneCall" }], [CANCEL, { oid, reason_code: "duplicate" }], [PACKED, { oid }], [DISPATCH, { oid, courier: "Pathao" }], [DELIVER, { oid }], [NOT_DELIVERED, { oid, reason: "refused" }], [REFUND, { oid, amount: 1, method: "cash" }]]) {
            assert.equal((await h.call(route, { body, token: viewer })).status, 403, route);
            assert.equal((await h.call(route, { body })).status, 401, route);
        }
        assert.equal((await order_row(oid)).status, "Pending");
    });
});
