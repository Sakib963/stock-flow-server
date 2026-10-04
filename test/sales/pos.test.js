const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { execute_transaction } = require("../../src/db/database");
const { openBatch, holdStock } = require("../../src/routes/sales/utils/stock-movement");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");
const { business_today } = require("../../src/utils/business-time");

const BASE = CONTEXTS.SALES + SUB_CONTEXTS.POS;
const PRODUCTS = BASE + ROUTES.GET_POS_PRODUCT_LIST;
const CHECKOUT = BASE + ROUTES.CHECKOUT_POS_SALE;
const PARK = BASE + ROUTES.PARK_POS_CART;
const PARKED = BASE + ROUTES.GET_PARKED_CARTS;
const DISCARD = BASE + ROUTES.DISCARD_PARKED_CART;
const EDIT_ORDER = CONTEXTS.SALES + SUB_CONTEXTS.ORDER + ROUTES.EDIT_PENDING_ORDER;

const COUNTER = ["sales.pos.view", "sales.pos.create"];
const USER = "owner@arithmalabs.test";

before(h.start);
after(h.stop);

let seq = 0;
const person = async (permissions = COUNTER) => (await h.sign_in(await h.seed_user({ email: `counter${++seq}@arithmalabs.test`, permissions }))).access;
const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });

let product;
const seed_product = async () => {
    await h.query("TRUNCATE stock_movement, stock_hold, product_stats, order_status_history, order_items, orders, customer_address, customers, inventory, product, sub_categories, categories CASCADE");
    const category = uuidv4();
    const sub_category = uuidv4();
    product = uuidv4();
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Tops', 'TOPS', $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Floral kurti', 'KURTI-38', $2, $3, 5, 'Active')", [product, category, sub_category]);
};

// A sellable batch, opened through the stock helper so its ledger starts balanced.
const batch = async ({ code, quantity, price = 890, max_discount = 50 }) => {
    const oid = uuidv4();
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, selling_price, maximum_discount, intended_use, status) VALUES ($1, $2, $3, $4, $4, 450, $5, $6, 'for_sale', 'ready_for_sale')", [oid, code, product, quantity, price, max_discount]);
    await execute_transaction((tx) => openBatch(tx, { inventory_oid: oid, quantity, reason: "opening_stock", source_oid: oid, user_id: USER }));
    return oid;
};

const on_hand = async (oid) => (await h.query("SELECT quantity_available::int AS q FROM inventory WHERE oid = $1", [oid]))[0].q;
const movements = (oid) => h.query("SELECT reason, quantity, balance_after, source_oid FROM stock_movement WHERE inventory_oid = $1 ORDER BY created_on, oid", [oid]);

// A batch's movement rows add up to what it holds, and the last balance says the same.
const assert_balanced = async (oid) => {
    const held = await on_hand(oid);
    const rows = await movements(oid);
    assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), held);
    assert.equal(rows.at(-1).balance_after, held);
};

const order_of = async (oid) => (await h.query("SELECT status, channel, customer_oid, sold_on, subtotal::int, discount_total::int, total_amount::int, amount_paid::int, payment_status, draft_label, invoice_no FROM orders WHERE oid = $1", [oid]))[0];
const count = async (table) => (await h.query(`SELECT COUNT(*)::int AS n FROM ${table}`))[0].n;

const sale = (lines, extra = {}) => {
    const total_amount = extra.total_amount ?? lines.reduce((sum, l) => sum + (890 - (l.discount ?? 0)) * l.quantity, 0);
    return { oid: uuidv4(), payment_method: "cash", payment_status: "paid", ...extra, total_amount, lines };
};

describe("selling at the counter", () => {
    let token;
    let b1;
    beforeEach(async () => {
        await h.reset();
        await seed_product();
        token = await person();
        b1 = await batch({ code: "B-7KQ2-91X", quantity: 10 });
    });

    it("prices the sale from the batch, takes the stock off that batch and records it as sold", async () => {
        const res = await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 2, discount: 40 }]), token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const oid = res.body.data.oid;

        const order = await order_of(oid);
        assert.equal(order.status, "Purchased");
        assert.equal(order.channel, "POS");
        assert.equal(order.customer_oid, null);
        assert.ok(order.sold_on);
        assert.deepEqual([order.subtotal, order.discount_total, order.total_amount, order.amount_paid], [1780, 80, 1700, 1700]);
        const [line] = await h.query("SELECT unit_price::int, discount::int, quantity::int, total::int FROM order_items WHERE order_oid = $1", [oid]);
        assert.deepEqual(line, { unit_price: 890, discount: 40, quantity: 2, total: 1700 });

        assert.equal(await on_hand(b1), 8);
        assert.deepEqual((await movements(b1)).at(-1), { reason: "sold", quantity: -2, balance_after: 8, source_oid: oid });
        await assert_balanced(b1);
        const [stats] = await h.query("SELECT total_sold::int FROM product_stats WHERE product_oid = $1", [product]);
        assert.equal(stats.total_sold, 2);
        const activity = await h.query("SELECT title FROM activity_log WHERE reference_oid = $1", [oid]);
        assert.deepEqual(activity.map((a) => a.title), ["Sold at the counter"]);
    });

    it("refuses a discount above the batch's maximum and sells nothing", async () => {
        const res = await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 1, discount: 60 }]), token });
        assert.equal(res.status, 400);
        assert.match(res.body.message, /at most 50 a unit/);
        assert.equal(await count("orders"), 0);
        assert.equal(await on_hand(b1), 10);
    });

    it("refuses when the cashier's total is not what the batches cost now", async () => {
        const res = await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 1 }], { total_amount: 500 }), token });
        assert.equal(res.status, 409);
        assert.equal(res.body.data.total_amount, 890);
        assert.equal(await on_hand(b1), 10);
    });

    it("refuses half a unit with a clear answer instead of failing the sale", async () => {
        const res = await h.call(CHECKOUT, { body: { ...sale([{ inventory_oid: b1, quantity: 1 }]), lines: [{ inventory_oid: b1, quantity: 1.5 }] }, token });
        assert.equal(res.status, 400);
        assert.equal(await count("orders"), 0);
    });

    it("records what a part payment says was handed over, and never an amount sent with a full payment", async () => {
        const part = await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 1 }], { payment_status: "partially_paid", amount_paid: 300 }), token });
        assert.equal(part.status, 200);
        assert.equal((await order_of(part.body.data.oid)).amount_paid, 300);

        const paid = await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 1 }], { amount_paid: 1 }), token });
        assert.equal(paid.status, 400);

        const whole = await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 1 }], { payment_status: "partially_paid", amount_paid: 890 }), token });
        assert.equal(whole.status, 400);
        assert.match(whole.body.message, /Mark the sale paid/);
        assert.equal(await count("orders"), 1);
        await assert_balanced(b1);
    });

    it("lets only one of two counters selling the last units have them", async () => {
        const last = await batch({ code: "B-LAST", quantity: 1 });
        const [a, b] = await Promise.all([h.call(CHECKOUT, { body: sale([{ inventory_oid: last, quantity: 1 }]), token }), h.call(CHECKOUT, { body: sale([{ inventory_oid: last, quantity: 1 }]), token })]);
        assert.deepEqual([a.status, b.status].sort(), [200, 409]);
        const refused = a.status === 409 ? a : b;
        assert.match(refused.body.message, /Only 0 left of Floral kurti, B-LAST/);
        assert.equal(await on_hand(last), 0);
        assert.equal(await count("orders"), 1);
        await assert_balanced(last);
    });

    it("gives two sales at once their own invoice numbers", async () => {
        const [a, b] = await Promise.all([h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 1 }]), token }), h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 1 }]), token })]);
        assert.deepEqual([a.status, b.status], [200, 200]);
        assert.notEqual(a.body.data.invoice_no, b.body.data.invoice_no);
        const [{ day }] = await h.query(`SELECT to_char(${business_today}, 'YYMMDD') AS day`);
        assert.ok(a.body.data.invoice_no.startsWith(day));
        await assert_balanced(b1);
    });

    it("records a checkout pressed twice once, and says which sale it already is", async () => {
        const body = sale([{ inventory_oid: b1, quantity: 2 }]);
        const first = await h.call(CHECKOUT, { body, token });
        assert.equal(first.status, 200);
        const again = await h.call(CHECKOUT, { body, token });
        assert.equal(again.status, 409);
        assert.equal(again.body.data.invoice_no, first.body.data.invoice_no);
        assert.equal(await count("orders"), 1);
        assert.equal(await on_hand(b1), 8);
        await assert_balanced(b1);
    });

    it("does not sell units an online order is holding", async () => {
        const online = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, channel, status, total_amount) VALUES ($1, 'ONLINE-1', 'ONLINE', 'Pending', 0)", [online]);
        await execute_transaction((tx) => holdStock(tx, { order_oid: online, product_oid: product, inventory_oid: b1, quantity: 8, user_id: USER }));

        const res = await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 3 }]), token });
        assert.equal(res.status, 409);
        assert.equal(res.body.data.sellable, 2);
        assert.equal(await on_hand(b1), 10);
    });

    it("refuses someone who may open the counter but not sell, and someone with no session", async () => {
        const viewer = await person(["sales.pos.view"]);
        assert.equal((await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 1 }]), token: viewer })).status, 403);
        assert.equal((await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 1 }]) })).status, 401);
        assert.equal(await on_hand(b1), 10);
    });
});

describe("the customer on a counter sale", () => {
    let token;
    let b1;
    beforeEach(async () => {
        await h.reset();
        await seed_product();
        token = await person();
        b1 = await batch({ code: "B-1", quantity: 10 });
    });

    it("attaches a known customer found by their phone, however it was typed", async () => {
        const known = uuidv4();
        await h.query("INSERT INTO customers (oid, name, phone, phone_normalized) VALUES ($1, 'Person A', '01987654321', '01987654321')", [known]);
        const res = await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 1 }], { customer: { phone: "+880 1987-654321" } }), token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal((await order_of(res.body.data.oid)).customer_oid, known);
        assert.equal(await count("customers"), 1);
        await assert_balanced(b1);
    });

    it("saves a new phone as a new customer with the name given", async () => {
        const res = await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 1 }], { customer: { phone: "01711000000", name: "Person B" } }), token });
        assert.equal(res.status, 200);
        const [customer] = await h.query("SELECT oid, name, phone_normalized FROM customers");
        assert.deepEqual([customer.name, customer.phone_normalized], ["Person B", "01711000000"]);
        assert.equal((await order_of(res.body.data.oid)).customer_oid, customer.oid);
        await assert_balanced(b1);
    });

    it("asks for the name of a new phone and sells nothing until it is given", async () => {
        const res = await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 1 }], { customer: { phone: "01711000000" } }), token });
        assert.equal(res.status, 400);
        assert.match(res.body.message, /Ask the customer's name/);
        assert.equal(await count("orders"), 0);
        assert.equal(await on_hand(b1), 10);
    });

    it("makes one customer when two counters sell to the same new phone at once", async () => {
        const body = () => sale([{ inventory_oid: b1, quantity: 1 }], { customer: { phone: "01711000000", name: "Person B" } });
        const [a, b] = await Promise.all([h.call(CHECKOUT, { body: body(), token }), h.call(CHECKOUT, { body: body(), token })]);
        assert.deepEqual([a.status, b.status], [200, 200]);
        assert.equal(await count("customers"), 1);
        assert.equal((await order_of(a.body.data.oid)).customer_oid, (await order_of(b.body.data.oid)).customer_oid);
        await assert_balanced(b1);
    });
});

describe("parked carts", () => {
    let token;
    let b1;
    const cart = (b, quantity = 2) => ({ oid: uuidv4(), draft_label: "Lady in blue", customer_phone: "01711000000", lines: [{ inventory_oid: b, quantity, discount: 0 }] });

    beforeEach(async () => {
        await h.reset();
        await seed_product();
        token = await person();
        b1 = await batch({ code: "B-1", quantity: 5 });
    });

    it("parks a cart as a Draft that touches no stock and every counter can see", async () => {
        const res = await h.call(PARK, { body: cart(b1), token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const order = await order_of(res.body.data.oid);
        assert.deepEqual([order.status, order.draft_label, order.sold_on, order.total_amount], ["Draft", "Lady in blue", null, 1780]);
        assert.equal(await on_hand(b1), 5);
        assert.equal((await movements(b1)).length, 1);
        assert.equal(await count("stock_hold"), 0);

        const other = await person();
        const parked = await get(PARKED, other);
        assert.equal(parked.status, 200);
        assert.equal(parked.body.data.length, 1);
        assert.deepEqual(parked.body.data[0].lines.map((l) => [l.batch_code, l.quantity, l.sellable, l.selling_price]), [["B-1", 2, 5, 890]]);
    });

    it("checks out a resumed cart under its own invoice number and takes the stock then", async () => {
        const parked = (await h.call(PARK, { body: cart(b1), token })).body.data;
        const res = await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 3 }], { oid: parked.oid }), token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.invoice_no, parked.invoice_no);
        const order = await order_of(parked.oid);
        assert.deepEqual([order.status, order.total_amount, order.draft_label], ["Purchased", 2670, null]);
        assert.equal(await count("order_items"), 1);
        assert.equal(await on_hand(b1), 2);
        await assert_balanced(b1);
        assert.equal((await get(PARKED, token)).body.data.length, 0);
    });

    it("refuses checking out a cart whose stock was sold while it waited, names the line, and keeps the cart", async () => {
        const parked = (await h.call(PARK, { body: cart(b1, 4), token })).body.data;
        assert.equal((await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 3 }]), token })).status, 200);

        const res = await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 4 }], { oid: parked.oid }), token });
        assert.equal(res.status, 409);
        assert.match(res.body.message, /Only 2 left of Floral kurti, B-1/);
        assert.equal((await order_of(parked.oid)).status, "Draft");
        assert.equal(await on_hand(b1), 2);
        await assert_balanced(b1);
    });

    it("sells a parked cart once when two counters check it out at the same time", async () => {
        const parked = (await h.call(PARK, { body: cart(b1), token })).body.data;
        const body = sale([{ inventory_oid: b1, quantity: 2 }], { oid: parked.oid });
        const [a, b] = await Promise.all([h.call(CHECKOUT, { body, token }), h.call(CHECKOUT, { body, token })]);
        assert.deepEqual([a.status, b.status].sort(), [200, 409]);
        assert.equal(await on_hand(b1), 3);
        await assert_balanced(b1);
    });

    it("updates a parked cart in place when it is parked again", async () => {
        const parked = (await h.call(PARK, { body: cart(b1), token })).body.data;
        const again = await h.call(PARK, { body: { ...cart(b1, 1), oid: parked.oid, draft_label: "Table 2" }, token });
        assert.equal(again.status, 200);
        assert.equal(await count("orders"), 1);
        assert.deepEqual([(await order_of(parked.oid)).draft_label, (await order_of(parked.oid)).total_amount], ["Table 2", 890]);
    });

    it("keeps one parked cart when the same park is sent twice", async () => {
        const body = cart(b1);
        assert.equal((await h.call(PARK, { body, token })).status, 200);
        assert.equal((await h.call(PARK, { body, token })).status, 200);
        assert.equal(await count("orders"), 1);
    });

    it("discards a parked cart as Cancelled, moving nothing, and only once", async () => {
        const parked = (await h.call(PARK, { body: cart(b1), token })).body.data;
        const res = await h.call(DISCARD, { body: { oid: parked.oid }, token });
        assert.equal(res.status, 200);
        assert.equal((await order_of(parked.oid)).status, "Cancelled");
        assert.equal((await movements(b1)).length, 1);
        assert.equal((await h.call(DISCARD, { body: { oid: parked.oid }, token })).status, 409);
        assert.equal((await h.call(CHECKOUT, { body: sale([{ inventory_oid: b1, quantity: 2 }], { oid: parked.oid }), token })).status, 409);
        assert.equal(await on_hand(b1), 5);
    });

    it("keeps parking, resuming and discarding to people who can sell", async () => {
        const viewer = await person(["sales.pos.view"]);
        assert.equal((await h.call(PARK, { body: cart(b1), token: viewer })).status, 403);
        assert.equal((await get(PARKED, viewer)).status, 403);
        assert.equal((await h.call(DISCARD, { body: { oid: uuidv4() }, token: viewer })).status, 403);
    });
});

describe("finding products at the counter", () => {
    let token;
    beforeEach(async () => {
        await h.reset();
        await seed_product();
        token = await person();
    });

    it("finds a batch by its code with the scanned code first, and shows only what can be sold", async () => {
        const b1 = await batch({ code: "KQ-100", quantity: 5 });
        await batch({ code: "KQ-1001", quantity: 5 });
        const held = await batch({ code: "KQ-1002", quantity: 2 });
        const online = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, channel, status, total_amount) VALUES ($1, 'ONLINE-1', 'ONLINE', 'Pending', 0)", [online]);
        await execute_transaction((tx) => holdStock(tx, { order_oid: online, product_oid: product, inventory_oid: held, quantity: 2, user_id: USER }));

        const res = await get(PRODUCTS, token, { search_text: "kq-100" });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data.map((r) => r.batch_code), ["KQ-100", "KQ-1001"]);
        assert.equal(res.body.data[0].inventory_oid, b1);
        assert.equal(res.body.data[0].sellable_quantity, 5);
    });

    it("refuses someone without the counter", async () => {
        const other = await person(["sales.customer.view"]);
        assert.equal((await get(PRODUCTS, other)).status, 403);
    });
});

describe("editing a Pending online order", () => {
    it("records the paid amount from the payment status, never the amount the client sent", async () => {
        await h.reset();
        await seed_product();
        const b1 = await batch({ code: "B-1", quantity: 5 });
        const token = await person();
        const oid = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, channel, status, total_amount, subtotal, payment_status) VALUES ($1, 'ONLINE-2', 'ONLINE', 'Pending', 890, 890, 'unpaid')", [oid]);

        const res = await h.call(EDIT_ORDER, { body: { oid, payment_status: "paid", amount_paid: 5, products: [{ inventory_oid: b1, product_oid: product, product_name: "Floral kurti", quantity: 1, unit_price: 890, discount: 0, total: 890 }] }, token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const order = await order_of(oid);
        assert.deepEqual([order.payment_status, order.amount_paid], ["paid", 890]);
    });
});
