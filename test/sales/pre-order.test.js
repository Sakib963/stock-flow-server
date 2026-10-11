const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { execute_transaction } = require("../../src/db/database");
const { openBatch, holdStock } = require("../../src/routes/sales/utils/stock-movement");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const PRE = CONTEXTS.SALES + SUB_CONTEXTS.PRE_ORDER;
const CREATE = PRE + ROUTES.CREATE_PRE_ORDER;
const UPDATE = PRE + ROUTES.UPDATE_PRE_ORDER;
const CONFIRM = PRE + ROUTES.CONFIRM_PRE_ORDER;
const CANCEL = PRE + ROUTES.CANCEL_PRE_ORDER;
const REFUND = PRE + ROUTES.RECORD_PRE_ORDER_REFUND;
const LIST = PRE + ROUTES.GET_PRE_ORDER_LIST;
const DETAILS = PRE + ROUTES.GET_PRE_ORDER_DETAILS;
const PRODUCTS = PRE + ROUTES.GET_PRODUCT_LIST_FOR_PRE_ORDER;
const BY_PRODUCT = PRE + ROUTES.GET_PRE_ORDERS_BY_PRODUCT;
const OPEN_BOOKINGS = PRE + ROUTES.FIND_OPEN_BOOKINGS;

const ALL = ["sales.pre-order.view", "sales.pre-order.create", "sales.pre-order.edit", "sales.pre-order.confirm", "sales.pre-order.cancel"];
const USER = "owner@arithmalabs.test";

before(h.start);
after(h.stop);

let seq = 0;
const person = async (permissions = ALL) => (await h.sign_in(await h.seed_user({ email: `bookings${++seq}@arithmalabs.test`, permissions }))).access;
const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });

let kurti;
let scarf;
const stock = async (product, quantity) => {
    const oid = uuidv4();
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, selling_price, maximum_discount, intended_use, status) VALUES ($1, $2, $3, $4, $4, 700, 1450, 100, 'for_sale', 'ready_for_sale')", [oid, `B-${oid.slice(0, 4)}`, product, quantity]);
    await execute_transaction((tx) => openBatch(tx, { inventory_oid: oid, quantity, reason: "opening_stock", source_oid: oid, user_id: USER }));
    return oid;
};
const booking = (lines, extra = {}) => ({ oid: uuidv4(), customer: { phone: "01711000111", name: "Nusrat" }, lines, ...extra });
const book = async (token, lines, extra = {}) => {
    const body = booking(lines, extra);
    const saved = await h.call(CREATE, { body, token });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    return Object.defineProperty(body, "preorder_no", { value: saved.body.data.preorder_no, enumerable: false });
};
const shelf = async () => (await h.query("SELECT (SELECT COUNT(*) FROM stock_movement)::int AS movements, (SELECT COUNT(*) FROM stock_hold)::int AS holds, (SELECT COUNT(*) FROM orders)::int AS orders, (SELECT COALESCE(SUM(quantity_available), 0) FROM inventory)::int AS on_hand"))[0];

describe("pre-orders, bookings", () => {
    beforeEach(async () => {
        await h.query("TRUNCATE pre_order_status_history, pre_order_items, pre_orders, stock_movement, stock_hold, activity_log, order_items, orders, customers, inventory, product, sub_categories, categories CASCADE");
        const category = uuidv4();
        const sub_category = uuidv4();
        kurti = uuidv4();
        scarf = uuidv4();
        await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
        await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Tops', 'TOPS', $2, 'Active')", [sub_category, category]);
        await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Block print kurti', 'KURTI-1', $3, $4, 5, 'Active'), ($2, 'Silk scarf', 'SCARF-1', $3, $4, 5, 'Active')", [kurti, scarf, category, sub_category]);
    });

    it("saves a booking for a product never bought, which touches no stock, order or hold", async () => {
        const token = await person();
        await stock(scarf, 4);
        const before = await shelf();
        const saved = await book(token, [{ product_oid: kurti, quantity: 2, unit_price: 1500 }, { product_oid: scarf, quantity: 1, unit_price: 900 }], { advance_paid: 500, advance_method: "bkash" });
        assert.match(saved.preorder_no, /^PRE-\d{4}-\d{4}$/);
        assert.deepEqual(await shelf(), before, "a booking is not an order and holds nothing");

        const details = (await get(`${DETAILS}/${saved.oid}`, token)).body.data;
        assert.deepEqual({ status: details.status, total: details.total_amount, advance: details.advance_paid, customer: details.customer_name }, { status: "Pending", total: 3900, advance: 500, customer: "Nusrat" });
        assert.deepEqual(details.lines.map((line) => [line.product_name, line.quantity, line.total, line.sellable]), [["Block print kurti", 2, 3000, 0], ["Silk scarf", 1, 900, 4]]);
        assert.equal(details.activity[0].title, "Pre-order saved");
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM customers WHERE phone_normalized = '01711000111'"))[0].n, 1, "the new phone joined the customer book");
    });

    it("gives two bookings saved at the same moment their own numbers, and a repeated save the same one", async () => {
        const token = await person();
        const [a, b] = await Promise.all([h.call(CREATE, { body: booking([{ product_oid: kurti, quantity: 1, unit_price: 1500 }]), token }), h.call(CREATE, { body: booking([{ product_oid: kurti, quantity: 1, unit_price: 1500 }]), token })]);
        assert.equal(a.status, 200, JSON.stringify(a.body));
        assert.equal(b.status, 200, JSON.stringify(b.body));
        assert.notEqual(a.body.data.preorder_no, b.body.data.preorder_no);

        const body = booking([{ product_oid: kurti, quantity: 1, unit_price: 1500 }]);
        const first = await h.call(CREATE, { body, token });
        const again = await h.call(CREATE, { body, token });
        assert.equal(again.body.data.preorder_no, first.body.data.preorder_no);
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM pre_orders"))[0].n, 3);
    });

    it("refuses an advance above the booking's total, and an advance with no method", async () => {
        const token = await person();
        const over = await h.call(CREATE, { body: booking([{ product_oid: kurti, quantity: 1, unit_price: 1500 }], { advance_paid: 2000, advance_method: "cash" }), token });
        assert.equal(over.status, 400);
        const no_method = await h.call(CREATE, { body: booking([{ product_oid: kurti, quantity: 1, unit_price: 1500 }], { advance_paid: 500 }), token });
        assert.equal(no_method.status, 400);
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM pre_orders"))[0].n, 0);
    });

    it("edits every line while Pending, and once Confirmed only prices and money, never the units", async () => {
        const token = await person();
        const saved = await book(token, [{ product_oid: kurti, quantity: 2, unit_price: 1500 }]);
        const edited = await h.call(UPDATE, { body: { ...saved, lines: [{ product_oid: kurti, quantity: 3, unit_price: 1500 }, { product_oid: scarf, quantity: 1, unit_price: 900 }] }, token });
        assert.equal(edited.status, 200, JSON.stringify(edited.body));
        assert.equal((await get(`${DETAILS}/${saved.oid}`, token)).body.data.total_amount, 5400);

        assert.equal((await h.call(CONFIRM, { body: { oid: saved.oid }, token })).status, 200);
        const more = await h.call(UPDATE, { body: { ...saved, lines: [{ product_oid: kurti, quantity: 4, unit_price: 1500 }, { product_oid: scarf, quantity: 1, unit_price: 900 }] }, token });
        assert.equal(more.status, 409, "a confirmed booking keeps its units");
        const cheaper = await h.call(UPDATE, { body: { ...saved, lines: [{ product_oid: kurti, quantity: 3, unit_price: 1400 }, { product_oid: scarf, quantity: 1, unit_price: 900 }], advance_paid: 1000, advance_method: "cash" }, token });
        assert.equal(cheaper.status, 200, JSON.stringify(cheaper.body));
        const details = (await get(`${DETAILS}/${saved.oid}`, token)).body.data;
        assert.deepEqual({ total: details.total_amount, advance: details.advance_paid }, { total: 5100, advance: 1000 });
        assert.equal(details.activity[0].description, `${saved.preorder_no}: prices, advance changed`);
    });

    it("confirms once, cancels with the refund owed, records the refund once, and then is final", async () => {
        const token = await person();
        const saved = await book(token, [{ product_oid: kurti, quantity: 2, unit_price: 1500 }], { advance_paid: 500, advance_method: "bkash" });
        assert.equal((await h.call(CONFIRM, { body: { oid: saved.oid }, token })).status, 200);
        assert.equal((await h.call(CONFIRM, { body: { oid: saved.oid }, token })).status, 409);

        assert.equal((await h.call(CANCEL, { body: { oid: saved.oid, reason: "stock_not_coming", refund_due: 600 }, token })).status, 400, "never more than the advance");
        assert.equal((await h.call(CANCEL, { body: { oid: saved.oid, reason: "other", refund_due: 0 }, token })).status, 400, "Other needs a note");
        const cancelled = await h.call(CANCEL, { body: { oid: saved.oid, reason: "stock_not_coming", refund_due: 400 }, token });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        assert.equal((await h.call(CANCEL, { body: { oid: saved.oid, reason: "changed_mind", refund_due: 0 }, token })).status, 409);
        assert.equal((await h.call(UPDATE, { body: saved, token })).status, 409, "a cancelled booking is final");
        assert.equal((await get(LIST, token)).body.data.rows[0].refund_owed, 400);

        assert.equal((await h.call(REFUND, { body: { oid: saved.oid }, token })).status, 200);
        assert.equal((await h.call(REFUND, { body: { oid: saved.oid }, token })).status, 409, "recorded once");
        const details = (await get(`${DETAILS}/${saved.oid}`, token)).body.data;
        assert.deepEqual({ status: details.status, reason: details.cancel_reason, due: details.advance_refund_due, refunded: details.advance_refunded }, { status: "Cancelled", reason: "stock_not_coming", due: 400, refunded: 400 });
        const history = await h.query("SELECT from_status, to_status FROM pre_order_status_history WHERE pre_order_oid = $1 ORDER BY performed_on", [saved.oid]);
        assert.deepEqual(history.map((row) => `${row.from_status}>${row.to_status}`), ["null>Pending", "Pending>Confirmed", "Confirmed>Cancelled"]);
    });

    it("lists a booking as ready only when sellable stock covers every line, and as overdue past its date", async () => {
        const token = await person();
        const kurti_batch = await stock(kurti, 3);
        await stock(scarf, 5);
        const ready = await book(token, [{ product_oid: kurti, quantity: 2, unit_price: 1500 }, { product_oid: scarf, quantity: 1, unit_price: 900 }]);
        const late = await book(token, [{ product_oid: kurti, quantity: 1, unit_price: 1500 }], { expected_date: "2026-01-01" });
        await book(token, [{ product_oid: kurti, quantity: 9, unit_price: 1500 }]);

        let list = (await get(LIST, token, { include: "stats", ready: "true" })).body;
        assert.deepEqual(list.data.rows.map((row) => row.oid).sort(), [ready.oid, late.oid].sort());
        assert.deepEqual(list.data.stats, { open: 2, ready: 2, overdue: 1, advance_held: 0 });
        assert.deepEqual((await get(LIST, token, { overdue: "true" })).body.data.rows.map((row) => row.oid), [late.oid]);

        const order = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, total_amount, status, channel) VALUES ($1, $1, 0, 'Pending', 'ONLINE')", [order]);
        await execute_transaction((tx) => holdStock(tx, { order_oid: order, product_oid: kurti, inventory_oid: kurti_batch, quantity: 2, user_id: USER }));
        list = (await get(LIST, token, { ready: "true" })).body;
        assert.deepEqual(list.data.rows.map((row) => row.oid), [late.oid], "units held for an order are not there for a booking");
    });

    it("never counts a batch with no selling price as ready, since no order can take it", async () => {
        const token = await person();
        const batch = await stock(kurti, 10);
        await h.query("UPDATE inventory SET selling_price = NULL WHERE oid = $1", [batch]);
        const saved = await book(token, [{ product_oid: kurti, quantity: 5, unit_price: 1500 }]);
        assert.deepEqual((await get(LIST, token, { ready: "true" })).body.data.rows, []);
        assert.equal((await get(`${DETAILS}/${saved.oid}`, token)).body.data.lines[0].sellable, 0);
    });

    it("adds up open bookings per product against what can be sold now, which is what the owner buys from", async () => {
        const token = await person();
        await stock(scarf, 2);
        await book(token, [{ product_oid: kurti, quantity: 3, unit_price: 1500 }, { product_oid: scarf, quantity: 1, unit_price: 900 }]);
        await book(token, [{ product_oid: kurti, quantity: 2, unit_price: 1500 }, { product_oid: scarf, quantity: 4, unit_price: 900 }]);
        const gone = await book(token, [{ product_oid: kurti, quantity: 7, unit_price: 1500 }]);
        await h.call(CANCEL, { body: { oid: gone.oid, reason: "changed_mind", refund_due: 0 }, token });

        const list = (await get(BY_PRODUCT, token, { include: "stats", sort: "to_get", order: "desc" })).body;
        assert.deepEqual(list.data.rows.map((row) => [row.product_name, row.units, row.bookings, row.sellable, row.to_get]), [["Block print kurti", 5, 2, 0, 5], ["Silk scarf", 5, 2, 2, 3]]);
        assert.deepEqual(list.data.stats, { products: 2, units: 10, to_get: 8 }, "a cancelled booking is not wanted any more");

        const product = (await get(`${CONTEXTS.CONFIGURATION}${SUB_CONTEXTS.PRODUCT}${ROUTES.GET_PRODUCT_DETAILS}/${kurti}`, await person(["configuration.product.view"]))).body.data;
        assert.equal(product.stock.booked, 5, "the product page shows units booked on open bookings");
        assert.equal((await get(BY_PRODUCT, await person(["sales.order.view"]))).status, 403);
    });

    it("guides the approximate price with what the product really sold at, and its cost only to someone who may see money", async () => {
        await stock(scarf, 5);
        const sale = async (status, unit_price, discount) => {
            const order = uuidv4();
            await h.query("INSERT INTO orders (oid, invoice_no, total_amount, status, channel, sold_on) VALUES ($1, $1, 0, $2, 'POS', NOW())", [order, status]);
            await h.query("INSERT INTO order_items (oid, order_oid, product_oid, product_name, quantity, unit_price, discount, total) VALUES ($1, $2, $3, 'Silk scarf', 1, $4, $5, $6)", [uuidv4(), order, scarf, unit_price, discount, unit_price - discount]);
        };
        await sale("Purchased", 1450, 50);
        await sale("Delivered", 1450, 150);
        await sale("Purchased", 1450, 0);
        await sale("Pending", 900, 0);

        const row = async (permissions) => (await get(PRODUCTS, await person(permissions), { search: "scarf" })).body.data[0];
        const plain = await row(ALL);
        assert.deepEqual({ usual: plain.usual_price, sales: plain.sales, from: plain.price_from, to: plain.price_to }, { usual: 1400, sales: 3, from: 1450, to: 1450 }, "the median of what customers paid after discount, never an order still pending");
        assert.equal(plain.last_cost, undefined, "cost is money");
        assert.equal((await row([...ALL, "inventory.stock-value.view"])).last_cost, 700);
        const never = (await get(PRODUCTS, await person(), { search: "kurti" })).body.data[0];
        assert.deepEqual({ usual: never.usual_price, sales: never.sales }, { usual: null, sales: 0 });
    });

    it("finds a customer's open bookings line by line, so the same product is not booked twice for them", async () => {
        const token = await person();
        const first = await book(token, [{ product_oid: kurti, quantity: 2, unit_price: 1500 }]);
        const gone = await book(token, [{ product_oid: scarf, quantity: 1, unit_price: 900 }]);
        await h.call(CANCEL, { body: { oid: gone.oid, reason: "changed_mind", refund_due: 0 }, token });
        await h.call(CREATE, { body: { ...booking([{ product_oid: scarf, quantity: 1, unit_price: 900 }]), customer: { phone: "01811999888", name: "Someone else" } }, token });

        const open = (await h.call(OPEN_BOOKINGS, { body: { phone: "+8801711000111" }, token })).body.data;
        assert.deepEqual(open.map((row) => [row.preorder_no, row.product_oid, row.quantity]), [[first.preorder_no, kurti, 2]], "only this customer's, only open ones");
        assert.equal((await h.call(OPEN_BOOKINGS, { body: { phone: "01711000111" }, token: await person(["sales.pre-order.view"]) })).status, 403);
    });

    it("reads a pasted chat message for someone who only takes bookings", async () => {
        const token = await person(["sales.pre-order.create"]);
        const read = await h.call(CONTEXTS.SALES + SUB_CONTEXTS.ONLINE + ROUTES.READ_CHAT_MESSAGE, { body: { text: "Name: Nusrat Jahan\nPhone: 01711000111\nI want the block print kurti" }, token });
        assert.equal(read.status, 200, JSON.stringify(read.body));
        assert.equal(read.body.data.phone, "01711000111");
    });

    it("offers the whole catalogue to book from, with what can be sold now", async () => {
        const token = await person();
        await stock(scarf, 5);
        const rows = (await get(PRODUCTS, token, { search: "" })).body.data;
        assert.deepEqual(rows.map((row) => [row.product_name, row.sellable, row.price]), [["Block print kurti", 0, 0], ["Silk scarf", 5, 1450]]);
        assert.deepEqual((await get(PRODUCTS, token, { search: "kurti" })).body.data.map((row) => row.product_oid), [kurti]);
    });

    it("refuses each action to someone without its permission, and everything without a sign in", async () => {
        const owner = await person();
        const saved = await book(owner, [{ product_oid: kurti, quantity: 1, unit_price: 1500 }]);
        const viewer = await person(["sales.pre-order.view"]);
        assert.equal((await get(LIST, viewer)).status, 200);
        assert.equal((await h.call(CREATE, { body: booking([{ product_oid: kurti, quantity: 1, unit_price: 1500 }]), token: viewer })).status, 403);
        assert.equal((await h.call(UPDATE, { body: saved, token: viewer })).status, 403);
        assert.equal((await h.call(CONFIRM, { body: { oid: saved.oid }, token: viewer })).status, 403);
        assert.equal((await h.call(CANCEL, { body: { oid: saved.oid, reason: "changed_mind", refund_due: 0 }, token: viewer })).status, 403);
        assert.equal((await h.call(REFUND, { body: { oid: saved.oid }, token: viewer })).status, 403);
        assert.equal((await get(PRODUCTS, viewer)).status, 403);
        assert.equal((await get(LIST, await person(["sales.order.view"]))).status, 403);
        assert.equal((await get(LIST, null)).status, 401);
    });
});
