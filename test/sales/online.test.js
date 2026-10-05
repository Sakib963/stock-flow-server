const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { execute_transaction } = require("../../src/db/database");
const { openBatch, holdStock } = require("../../src/routes/sales/utils/stock-movement");
const { reload_location_index } = require("../../src/routes/sales/location/utils/location-index");
const { invalidateSettings } = require("../../src/utils/settings-cache");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const ONLINE = CONTEXTS.SALES + SUB_CONTEXTS.ONLINE;
const SETUP = ONLINE + ROUTES.GET_ONLINE_ORDER_SETUP;
const SAVE_DRAFT = ONLINE + ROUTES.SAVE_ONLINE_DRAFT;
const DRAFTS = ONLINE + ROUTES.GET_ONLINE_DRAFTS;
const DISCARD_DRAFT = ONLINE + ROUTES.DISCARD_ONLINE_DRAFT;
const READ = ONLINE + ROUTES.READ_CHAT_MESSAGE;
const CREATE = ONLINE + ROUTES.CREATE_ONLINE_ORDER;
const PRODUCTS = CONTEXTS.SALES + SUB_CONTEXTS.POS + ROUTES.GET_POS_PRODUCT_LIST;
const ORDER_DETAILS = CONTEXTS.SALES + SUB_CONTEXTS.ORDER + ROUTES.GET_ORDER_DETAILS;
const RETURN_DETAILS = CONTEXTS.SALES + SUB_CONTEXTS.RETURN + ROUTES.GET_RETURN_DETAILS;
const DELIVERY_CHARGES = CONTEXTS.SALES + SUB_CONTEXTS.SETTINGS + ROUTES.UPDATE_DELIVERY_CHARGES;

const MODERATOR = ["sales.online.view", "sales.online.create"];
const USER = "owner@arithmalabs.test";
const SOURCE = uuidv4();
const MOHAMMADPUR = "T-Dhaka-Mohammadpur";

before(h.start);
after(h.stop);

let seq = 0;
const person = async (permissions = MODERATOR) => (await h.sign_in(await h.seed_user({ email: `moderator${++seq}@arithmalabs.test`, permissions }))).access;

let product;
const seed = async () => {
    await h.query("TRUNCATE stock_movement, stock_hold, product_stats, order_status_history, order_items, online_order, product_return, orders, customer_address, customers, order_source, inventory, product, sub_categories, categories, location_alias, area, post_office, thana, district, division, settings CASCADE");
    await h.query("INSERT INTO division (oid, name_en, name_bn) VALUES ('BD-Dhaka-Division', 'Dhaka Division', 'ঢাকা বিভাগ'), ('BD-Khulna-Division', 'Khulna Division', 'খুলনা বিভাগ'), ('BD-Chittagong-Division', 'Chittagong Division', 'চট্টগ্রাম বিভাগ')");
    await h.query("INSERT INTO district (oid, name_en, name_bn, division_oid) VALUES ('BD-Dhaka', 'Dhaka', 'ঢাকা', 'BD-Dhaka-Division'), ('BD-Magura', 'Magura', 'মাগুরা', 'BD-Khulna-Division'), ('BD-Coxs-Bazar', 'Coxs Bazar', 'কক্সবাজার', 'BD-Chittagong-Division')");
    await h.query("INSERT INTO thana (oid, name_en, name_bn, type, postal_code, district_oid) VALUES ($1, 'Mohammadpur', 'মোহাম্মদপুর', 'Thana', '1207', 'BD-Dhaka'), ('T-Magura-Mohammadpur', 'Mohammadpur', 'মোহাম্মদপুর', 'Upazila', '7630', 'BD-Magura'), ('T-Ukhia', 'Ukhia', 'উখিয়া', 'Upazila', '4750', 'BD-Coxs-Bazar')", [MOHAMMADPUR]);
    await h.query("INSERT INTO settings (oid, name, delivery_charge_inside, delivery_charge_outside, home_district_oid) VALUES ($1, 'A boutique', 60, 120, 'BD-Dhaka')", [uuidv4()]);
    await h.query("INSERT INTO order_source (oid, platform, name, status) VALUES ($1, 'Facebook', 'Facebook page', 'Active'), ($2, 'Other', 'Old page', 'Inactive')", [SOURCE, uuidv4()]);
    invalidateSettings();
    await reload_location_index();

    const category = uuidv4();
    const sub_category = uuidv4();
    product = uuidv4();
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Tops', 'TOPS', $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Floral kurti', 'KURTI-38', $2, $3, 5, 'Active')", [product, category, sub_category]);
};

const batch = async ({ code, quantity, price = 1450, max_discount = 100 }) => {
    const oid = uuidv4();
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, selling_price, maximum_discount, intended_use, status) VALUES ($1, $2, $3, $4, $4, 700, $5, $6, 'for_sale', 'ready_for_sale')", [oid, code, product, quantity, price, max_discount]);
    await execute_transaction((tx) => openBatch(tx, { inventory_oid: oid, quantity, reason: "opening_stock", source_oid: oid, user_id: USER }));
    return oid;
};

const on_hand = async (oid) => (await h.query("SELECT quantity_available::int AS q FROM inventory WHERE oid = $1", [oid]))[0].q;
const movements = (oid) => h.query("SELECT reason, quantity, balance_after, source_oid FROM stock_movement WHERE inventory_oid = $1 ORDER BY created_on, oid", [oid]);
const holds = (order_oid) => h.query("SELECT inventory_oid, quantity::int, status FROM stock_hold WHERE order_oid = $1", [order_oid]);
const count = async (table) => (await h.query(`SELECT COUNT(*)::int AS n FROM ${table}`))[0].n;

const assert_balanced = async (oid) => {
    const held = await on_hand(oid);
    const rows = await movements(oid);
    assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), held);
    assert.equal(rows.at(-1).balance_after, held);
};

const new_address = { recipient_name: "Person A", address_line: "5/5, Gaznabi Road", district_oid: "BD-Dhaka", thana_oid: MOHAMMADPUR, area_text: "Gaznabi Road", postal_code: "1207" };

const order = (lines, extra = {}) => {
    const delivery_charge = extra.delivery_charge ?? 60;
    const total_amount = extra.total_amount ?? lines.reduce((sum, l) => sum + (1450 - (l.discount ?? 0)) * l.quantity, 0) + delivery_charge;
    return { oid: uuidv4(), customer: { phone: "01987654321", name: "Person A" }, address: new_address, source_oid: SOURCE, payment_type: "COD", ...extra, delivery_charge, total_amount, lines };
};

describe("taking an online order", () => {
    let token;
    let b1;
    beforeEach(async () => {
        await h.reset();
        await seed();
        token = await person();
        b1 = await batch({ code: "B-7KQ2-91X", quantity: 6 });
    });

    it("places it Pending, holds the stock without moving it, and saves the customer and their address with it", async () => {
        const body = order([{ inventory_oid: b1, quantity: 2, discount: 50 }], { customer: { phone: "+880 1987-654321", name: "Person A", gender: "Female", age_band: "25_34" } });
        const res = await h.call(CREATE, { body, token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const oid = res.body.data.oid;
        assert.equal(oid, body.oid);

        const [o] = await h.query("SELECT status, channel, sold_on, subtotal::int, discount_total::int, delivery_charge::int, total_amount::int, amount_paid::int, payment_type, payment_status, payment_method, customer_oid FROM orders WHERE oid = $1", [oid]);
        assert.deepEqual({ ...o, customer_oid: undefined }, { status: "Pending", channel: "ONLINE", sold_on: null, subtotal: 2900, discount_total: 100, delivery_charge: 60, total_amount: 2860, amount_paid: 0, payment_type: "COD", payment_status: "unpaid", payment_method: "cod", customer_oid: undefined });
        const [line] = await h.query("SELECT unit_price::int, discount::int, quantity::int, total::int FROM order_items WHERE order_oid = $1", [oid]);
        assert.deepEqual(line, { unit_price: 1450, discount: 50, quantity: 2, total: 2800 });

        assert.deepEqual(await holds(oid), [{ inventory_oid: b1, quantity: 2, status: "Active" }]);
        assert.equal(await on_hand(b1), 6);
        assert.equal((await movements(b1)).length, 1, "holding writes no movement: the shelf did not change");
        await assert_balanced(b1);

        const [customer] = await h.query("SELECT oid, name, phone_normalized, gender, age_band, first_source_oid FROM customers");
        assert.deepEqual({ ...customer, oid: undefined }, { oid: undefined, name: "Person A", phone_normalized: "01987654321", gender: "Female", age_band: "25_34", first_source_oid: SOURCE });
        assert.equal(o.customer_oid, customer.oid);
        const [address] = await h.query("SELECT oid, is_default, district_oid, thana_oid FROM customer_address WHERE customer_oid = $1", [customer.oid]);
        assert.equal(address.is_default, true);

        const [online] = await h.query("SELECT customer_address_oid, recipient_name, recipient_phone, address_line, division_oid, district_oid, thana_oid, area_text, postal_code, source_oid, risk_flag, delivery_status FROM online_order WHERE order_oid = $1", [oid]);
        assert.deepEqual(online, { customer_address_oid: address.oid, recipient_name: "Person A", recipient_phone: "01987654321", address_line: "5/5, Gaznabi Road", division_oid: "BD-Dhaka-Division", district_oid: "BD-Dhaka", thana_oid: MOHAMMADPUR, area_text: "Gaznabi Road", postal_code: "1207", source_oid: SOURCE, risk_flag: "None", delivery_status: null });

        const [history] = await h.query("SELECT from_status, to_status FROM order_status_history WHERE order_oid = $1", [oid]);
        assert.deepEqual(history, { from_status: null, to_status: "Pending" });
        const activity = await h.query("SELECT title FROM activity_log WHERE reference_oid = $1", [oid]);
        assert.deepEqual(activity.map((a) => a.title), ["Online order placed"]);
    });

    it("attaches a returning customer's order to them with a saved address, never a new customer row", async () => {
        const first = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { customer: { phone: "01987654321", name: "Person A", gender: "Female" } }), token });
        const [address] = await h.query("SELECT oid FROM customer_address");
        const again = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { customer: { phone: "01987654321", name: "Someone else", gender: "Male" }, address: { oid: address.oid } }), token });
        assert.equal(again.status, 200, JSON.stringify(again.body));
        assert.equal(again.body.data.customer_oid, first.body.data.customer_oid);
        assert.equal(await count("customers"), 1);
        assert.equal(await count("customer_address"), 1);
        const [customer] = await h.query("SELECT name, gender FROM customers");
        assert.deepEqual(customer, { name: "Person A", gender: "Female" }, "an order never renames a customer or overwrites what is known");
    });

    it("refuses an address that belongs to another customer", async () => {
        await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { customer: { phone: "01711000000", name: "Person B" } }), token });
        const [theirs] = await h.query("SELECT oid FROM customer_address");
        const res = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { address: { oid: theirs.oid } }), token });
        assert.equal(res.status, 409);
        assert.equal(await count("orders"), 1);
    });

    it("refuses a thana outside the district picked, and saves nothing", async () => {
        const res = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { address: { ...new_address, district_oid: "BD-Magura" } }), token });
        assert.equal(res.status, 400);
        assert.deepEqual([await count("orders"), await count("customers"), await count("stock_hold")], [0, 0, 0]);
    });

    it("needs a district and thana, and a source still in use", async () => {
        const { district_oid, ...no_district } = new_address;
        assert.equal((await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { address: no_district }), token })).status, 400);
        const [old] = await h.query("SELECT oid FROM order_source WHERE status = 'Inactive'");
        const retired = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { source_oid: old.oid }), token });
        assert.equal(retired.status, 400);
        assert.match(retired.body.message, /source/);
        assert.equal(await count("orders"), 0);
    });

    it("prices every line from its batch and refuses a discount above the batch's maximum", async () => {
        const res = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1, discount: 150 }]), token });
        assert.equal(res.status, 400);
        assert.match(res.body.message, /at most 100 a unit/);
        assert.equal(await count("stock_hold"), 0);
    });

    it("refuses when the confirmed total is not what the batches and delivery cost now", async () => {
        const res = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { total_amount: 1450 }), token });
        assert.equal(res.status, 409);
        assert.equal(res.body.data.total_amount, 1510);
        assert.equal(await count("orders"), 0);
    });

    it("records the money by its terms: COD nothing paid, an advance as part paid, prepaid as the whole total", async () => {
        const advance = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { payment_type: "ADVANCE", payment_method: "bkash", amount_paid: 60 }), token });
        assert.equal(advance.status, 200, JSON.stringify(advance.body));
        const prepaid = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { payment_type: "PREPAID", payment_method: "nagad" }), token });
        const read = (oid) => h.query("SELECT payment_status, amount_paid::int, payment_method FROM orders WHERE oid = $1", [oid]).then((r) => r[0]);
        assert.deepEqual(await read(advance.body.data.oid), { payment_status: "partially_paid", amount_paid: 60, payment_method: "bkash" });
        assert.deepEqual(await read(prepaid.body.data.oid), { payment_status: "paid", amount_paid: 1510, payment_method: "nagad" });

        const whole = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { payment_type: "ADVANCE", payment_method: "bkash", amount_paid: 1510 }), token });
        assert.equal(whole.status, 400);
        assert.match(whole.body.message, /prepaid/);
        assert.equal((await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { payment_type: "PREPAID", payment_method: "cash", amount_paid: 5 }), token })).status, 400, "a paid amount is never taken from the client");
        assert.equal((await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { amount_paid: 100 }), token })).status, 400);
    });

    it("refuses what is not sellable: units another order holds are not free, and nothing is held for it", async () => {
        const other = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, total_amount, channel, status) VALUES ($1, 'O-1', 0, 'ONLINE', 'Pending')", [other]);
        await execute_transaction((tx) => holdStock(tx, { order_oid: other, product_oid: product, inventory_oid: b1, quantity: 5, user_id: USER }));
        const res = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 2 }]), token });
        assert.equal(res.status, 409);
        assert.match(res.body.message, /Only 1 left/);
        assert.equal(await count("orders"), 1, "only the order already holding");
        assert.equal(await count("customers"), 0);
    });

    it("places an order only once when Create is pressed again after a lost answer", async () => {
        const body = order([{ inventory_oid: b1, quantity: 2 }]);
        const first = await h.call(CREATE, { body, token });
        const again = await h.call(CREATE, { body, token });
        assert.equal(first.status, 200);
        assert.equal(again.status, 409);
        assert.equal(again.body.data.invoice_no, first.body.data.invoice_no);
        assert.equal(await count("orders"), 1);
        assert.deepEqual(await holds(body.oid), [{ inventory_oid: b1, quantity: 2, status: "Active" }]);
    });

    it("lets only one of two moderators hold the last units", async () => {
        const results = await Promise.all([1, 2].map((n) => h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 4 }], { customer: { phone: `0171100000${n}`, name: `Person ${n}` } }), token })));
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        const [held] = await h.query("SELECT SUM(quantity)::int AS n FROM stock_hold WHERE inventory_oid = $1 AND status = 'Active'", [b1]);
        assert.equal(held.n, 4);
        await assert_balanced(b1);
    });

    it("asks before taking an order from a blocked customer, and logs it when told", async () => {
        await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }]), token });
        await h.query("UPDATE customers SET flag = 'Blocked', flag_reason = 'Refused two parcels'");
        const refused = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }]), token });
        assert.equal(refused.status, 409);
        assert.match(refused.body.message, /Refused two parcels/);

        const told = await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }], { blocked_acknowledged: true }), token });
        assert.equal(told.status, 200);
        const activity = await h.query("SELECT title FROM activity_log WHERE reference_oid = $1 ORDER BY title", [told.body.data.oid]);
        assert.deepEqual(activity.map((a) => a.title), ["Online order placed", "Placed for a blocked customer"]);
        const [online] = await h.query("SELECT risk_flag FROM online_order WHERE order_oid = $1", [told.body.data.oid]);
        assert.equal(online.risk_flag, "Blocked");
    });

    it("refuses a moderator without create, a counter-only person, and no sign in", async () => {
        assert.equal((await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }]) })).status, 401);
        assert.equal((await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }]), token: await person(["sales.online.view"]) })).status, 403);
        assert.equal((await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }]), token: await person(["sales.pos.view", "sales.pos.create"]) })).status, 403);
        assert.equal((await h.call(READ, { body: { text: "01987654321" }, token: await person(["sales.online.view"]) })).status, 403);
        assert.equal((await h.call(SETUP, { method: "GET", token: await person(["sales.pos.view"]) })).status, 403);
        assert.equal(await count("orders"), 0);
    });
});

describe("an online order saved as a draft", () => {
    let token;
    let b1;
    beforeEach(async () => {
        await h.reset();
        await seed();
        token = await person();
        b1 = await batch({ code: "B-1", quantity: 3 });
    });

    it("keeps a half-made order without holding stock or saving a customer, and places it later under the same invoice", async () => {
        const oid = uuidv4();
        const draft = { oid, draft_label: "Floral, size 38", customer: { phone: "01987654321", name: "Person A" }, address: new_address, source_oid: SOURCE, delivery_charge: 60, lines: [{ inventory_oid: b1, quantity: 2 }] };
        const saved = await h.call(SAVE_DRAFT, { body: draft, token });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.deepEqual([await count("stock_hold"), await count("customers"), await count("customer_address")], [0, 0, 0]);
        assert.equal((await h.call(SAVE_DRAFT, { body: { ...draft, lines: [{ inventory_oid: b1, quantity: 1 }] }, token })).status, 200, "saving again updates the one draft");

        const list = await h.call(DRAFTS, { method: "GET", token });
        assert.equal(list.body.data.length, 1);
        assert.deepEqual([list.body.data[0].draft_label, list.body.data[0].thana_name_en, list.body.data[0].lines[0].quantity], ["Floral, size 38", "Mohammadpur", 1]);

        const placed = await h.call(CREATE, { body: { ...order([{ inventory_oid: b1, quantity: 1 }]), oid }, token });
        assert.equal(placed.status, 200, JSON.stringify(placed.body));
        assert.equal(placed.body.data.invoice_no, saved.body.data.invoice_no);
        assert.match(placed.body.data.tracking_token, /^[0-9a-f]{32}$/);
        assert.equal(await count("orders"), 1);
        assert.deepEqual(await holds(oid), [{ inventory_oid: b1, quantity: 1, status: "Active" }]);
        assert.equal((await h.call(DRAFTS, { method: "GET", token })).body.data.length, 0);
        await assert_balanced(b1);
    });

    it("discards a draft as cancelled, never deleted, and refuses it twice", async () => {
        const oid = uuidv4();
        await h.call(SAVE_DRAFT, { body: { oid, lines: [{ inventory_oid: b1, quantity: 1 }] }, token });
        assert.equal((await h.call(DISCARD_DRAFT, { body: { oid }, token })).status, 200);
        assert.equal((await h.call(DISCARD_DRAFT, { body: { oid }, token })).status, 409);
        const [o] = await h.query("SELECT status FROM orders WHERE oid = $1", [oid]);
        assert.equal(o.status, "Cancelled");
        assert.equal((await h.call(SAVE_DRAFT, { body: { oid, lines: [{ inventory_oid: b1, quantity: 1 }] }, token: await person(["sales.online.view"]) })).status, 403);
    });
});

describe("the online order page's helpers", () => {
    let token;
    beforeEach(async () => {
        await h.reset();
        await seed();
        token = await person();
    });

    it("gives the sources in use and the two delivery charges", async () => {
        const res = await h.call(SETUP, { method: "GET", token });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data, { sources: [{ oid: SOURCE, platform: "Facebook", name: "Facebook page" }], delivery_charge_inside: 60, delivery_charge_outside: 120, home_district: { oid: "BD-Dhaka", name_en: "Dhaka", name_bn: "ঢাকা" }, logo_url: null });
    });

    it("reads a pasted message into phone, name, address and the places it can mean, with the customer behind the phone", async () => {
        const res = await h.call(READ, { body: { text: "person a, 01987654321, 5/5, gaznabi road, mohammadpur" }, token });
        assert.equal(res.status, 200);
        const data = res.body.data;
        assert.deepEqual([data.phone, data.name, data.address_line, data.lookup], ["01987654321", "Person A", "5/5, gaznabi road, mohammadpur", null]);
        assert.deepEqual(data.location.candidates.map((c) => [c.district.oid, c.rank]), [["BD-Dhaka", 1], ["BD-Magura", 2]], "both Mohammadpurs offered, the business's own district first");

        const b1 = await batch({ code: "B-1", quantity: 2 });
        await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }]), token });
        const known = await h.call(READ, { body: { text: "নাম: Person A\nমোবাইল: ০১৯৮৭৬৫৪৩২১\nঠিকানা: 5/5 Gaznabi Road, Mohammadpur, Magura" }, token });
        assert.equal(known.body.data.lookup.customer.name, "Person A");
        assert.equal(known.body.data.lookup.addresses.length, 1);
        assert.equal(known.body.data.location.candidates[0].district.oid, "BD-Magura");
    });

    it("offers a second phone as the recipient's, and reads a message with no phone without looking anyone up", async () => {
        const two = await h.call(READ, { body: { text: "01711000000, or call my husband 01811000000\nPerson C\nRoad 3, Mohammadpur, Dhaka" }, token });
        assert.deepEqual([two.body.data.phone, two.body.data.other_phones, two.body.data.name], ["01711000000", ["01811000000"], "Person C"]);
        const none = await h.call(READ, { body: { text: "5/5 gaznabi road mohammadpur" }, token });
        assert.deepEqual([none.body.data.phone, none.body.data.lookup], [null, null]);
    });

    it("reads a filled template, finds a thana spelt the way the customer wrote it, and leaves the products and the total out of the address", async () => {
        const text = "Name : tayeba \nThana : Ukhiya \nJela : Cox's Bazar \nTekana : kutupalong \nPhone :01620578921\n\nCotton pads 80pcs 190tk\n3W sunscreen 500tk\nDC 120tk\nTotal 810tk";
        const res = await h.call(READ, { body: { text }, token });
        assert.equal(res.status, 200);
        const data = res.body.data;
        assert.deepEqual([data.phone, data.name, data.address_line], ["01620578921", "Tayeba", "kutupalong"]);
        assert.deepEqual(data.location.candidates.map((c) => [c.thana?.oid, c.district.oid]), [["T-Ukhia", "BD-Coxs-Bazar"]]);
    });

    it("saves the delivery charges for the business's own district and outside it, for someone allowed to", async () => {
        const body = { home_district_oid: "BD-Coxs-Bazar", delivery_charge_inside: 80, delivery_charge_outside: 150 };
        assert.equal((await h.call(DELIVERY_CHARGES, { body, token })).status, 403);
        const [{ version }] = await h.query("SELECT version::int FROM config_version");
        const res = await h.call(DELIVERY_CHARGES, { body, token: await person(["sales.settings.edit"]) });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const setup = await h.call(SETUP, { method: "GET", token });
        assert.deepEqual([setup.body.data.home_district.oid, setup.body.data.delivery_charge_inside, setup.body.data.delivery_charge_outside], ["BD-Coxs-Bazar", 80, 150]);
        assert.equal((await h.query("SELECT version::int FROM config_version"))[0].version, version + 1);
        assert.equal((await h.call(DELIVERY_CHARGES, { body: { ...body, home_district_oid: "BD-Nowhere" }, token: await person(["sales.settings.edit"]) })).status, 400);
    });

    it("lets the online order search products as the counter does", async () => {
        await batch({ code: "B-1", quantity: 2 });
        const res = await h.call(`${PRODUCTS}?search_text=kurti`, { method: "GET", token: await person(["sales.online.view"]) });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.length, 1);
    });
});

describe("reading an order or a return", () => {
    let online_oid;
    let pos_oid;
    beforeEach(async () => {
        await h.reset();
        await seed();
        const b1 = await batch({ code: "B-1", quantity: 4 });
        online_oid = (await h.call(CREATE, { body: order([{ inventory_oid: b1, quantity: 1 }]), token: await person() })).body.data.oid;
        pos_oid = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, total_amount, channel, status, customer_address) VALUES ($1, 'P-1', 0, 'POS', 'Purchased', 'House 5, Road 2')", [pos_oid]);
    });

    const details = (oid, token) => h.call(`${ORDER_DETAILS}?oid=${oid}`, { method: "GET", token });

    it("needs the orders permission, and shows an order only in the person's channels", async () => {
        assert.equal((await details(online_oid, await person(MODERATOR))).status, 403);
        const online = await person(["sales.order.view", "sales.online.view"]);
        assert.equal((await details(online_oid, online)).status, 200);
        assert.equal((await details(pos_oid, online)).status, 404);
    });

    it("never gives a counter-only salesperson an address", async () => {
        const counter = await person(["sales.order.view", "sales.pos.view"]);
        assert.equal((await details(online_oid, counter)).status, 404);
        const res = await details(pos_oid, counter);
        assert.equal(res.status, 200);
        assert.equal("customer_address" in res.body.data, false);
        assert.equal("delivery_city" in res.body.data, false);
        assert.equal((await details(pos_oid, await person(["sales.order.view", "sales.pos.view", "sales.online.view"]))).body.data.customer_address, "House 5, Road 2");
    });

    it("needs the returns permission for a return, and shows it only in the person's channels without an address for the counter", async () => {
        const return_oid = uuidv4();
        await h.query("INSERT INTO product_return (oid, order_oid, invoice_no, refund_amount, status) VALUES ($1, $2, 'R-1', 0, 'Pending')", [return_oid, online_oid]);
        const read = (token) => h.call(`${RETURN_DETAILS}/${return_oid}`, { method: "GET", token });
        assert.equal((await read(await person(["sales.order.view", "sales.online.view"]))).status, 403);
        assert.equal((await read(await person(["sales.return.view", "sales.pos.view"]))).status, 404);
        const res = await read(await person(["sales.return.view", "sales.online.view"]));
        assert.equal(res.status, 200);
        assert.equal(res.body.data.customer_address, "5/5, Gaznabi Road");
    });
});
