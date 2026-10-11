const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { execute_transaction } = require("../../src/db/database");
const { openBatch, holdStock } = require("../../src/routes/sales/utils/stock-movement");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const GIVEAWAY = CONTEXTS.SALES + SUB_CONTEXTS.GIVEAWAY;
const CREATE = GIVEAWAY + ROUTES.CREATE_GIVEAWAY;
const GIVE = GIVEAWAY + ROUTES.GIVE_GIVEAWAY;
const CANCEL = GIVEAWAY + ROUTES.CANCEL_GIVEAWAY;
const LIST = GIVEAWAY + ROUTES.GET_GIVEAWAY_LIST;
const DETAILS = GIVEAWAY + ROUTES.GET_GIVEAWAY_DETAILS;

const ALL = ["sales.giveaway.view", "sales.giveaway.create", "sales.giveaway.confirm", "sales.giveaway.cancel"];
const USER = "owner@arithmalabs.test";

before(h.start);
after(h.stop);

let seq = 0;
const person = async (permissions = ALL) => (await h.sign_in(await h.seed_user({ email: `gifts${++seq}@arithmalabs.test`, permissions }))).access;
const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });

let product;
const batch = async (quantity) => {
    const oid = uuidv4();
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, selling_price, maximum_discount, intended_use, status) VALUES ($1, $2, $3, $4, $4, 700, 1450, 100, 'for_sale', 'ready_for_sale')", [oid, `B-${oid.slice(0, 4)}`, product, quantity]);
    await execute_transaction((tx) => openBatch(tx, { inventory_oid: oid, quantity, reason: "opening_stock", source_oid: oid, user_id: USER }));
    return oid;
};
const on_hand = async (oid) => (await h.query("SELECT quantity_available::int AS q FROM inventory WHERE oid = $1", [oid]))[0].q;
const movements = (oid) => h.query("SELECT reason, quantity, balance_after, source_oid FROM stock_movement WHERE inventory_oid = $1 ORDER BY created_on, oid", [oid]);
const given_away = async () => (await h.query("SELECT COALESCE(SUM(total_given_away), 0)::int AS given, COALESCE(SUM(total_sold), 0)::int AS sold FROM product_stats WHERE product_oid = $1", [product]))[0];
const assert_balanced = async (oid) => {
    const rows = await movements(oid);
    assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), await on_hand(oid));
    assert.equal(rows.at(-1).balance_after, await on_hand(oid));
};
const draft = async (token, lines, extra = {}) => {
    const oid = uuidv4();
    const saved = await h.call(CREATE, { body: { oid, recipient_name: "A younger brother", note: "Eid gift", lines, ...extra }, token });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    return oid;
};

describe("giveaways on their own", () => {
    beforeEach(async () => {
        await h.query("TRUNCATE stock_movement, stock_hold, giveaway_line, giveaway, activity_log, order_items, orders, customers, inventory, product, sub_categories, categories CASCADE");
        const category = uuidv4();
        const sub_category = uuidv4();
        product = uuidv4();
        await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
        await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Scarves', 'SCRF', $2, 'Active')", [sub_category, category]);
        await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Silk scarf', 'SCARF-1', $2, $3, 5, 'Active')", [product, category, sub_category]);
    });

    it("saves a draft that moves nothing, then Give takes the stock with a given away movement", async () => {
        const token = await person();
        const b1 = await batch(10);
        const oid = await draft(token, [{ inventory_oid: b1, quantity: 2 }]);
        assert.equal(await on_hand(b1), 10);
        assert.equal((await h.call(GIVE, { body: { oid }, token })).status, 200);
        assert.equal(await on_hand(b1), 8);
        assert.deepEqual((await movements(b1)).at(-1), { reason: "given_away", quantity: -2, balance_after: 8, source_oid: oid });
        assert.deepEqual(await given_away(), { given: 2, sold: 0 }, "counted as given away, never as sold");
        await assert_balanced(b1);
        assert.equal((await h.call(GIVE, { body: { oid }, token })).status, 409, "given once only");
        assert.equal(await on_hand(b1), 8);
        assert.equal((await given_away()).given, 2);
    });

    it("never gives units held for an online order, and takes nothing when one line is short", async () => {
        const token = await person();
        const b1 = await batch(3);
        const b2 = await batch(5);
        const order = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, total_amount, status, channel) VALUES ($1, 'INV-1', 2900, 'Pending', 'ONLINE')", [order]);
        await execute_transaction((tx) => holdStock(tx, { order_oid: order, product_oid: product, inventory_oid: b1, quantity: 2, user_id: USER }));
        const oid = await draft(token, [{ inventory_oid: b1, quantity: 2 }, { inventory_oid: b2, quantity: 1 }]);
        const res = await h.call(GIVE, { body: { oid }, token });
        assert.equal(res.status, 409);
        assert.deepEqual([await on_hand(b1), await on_hand(b2)], [3, 5]);
        assert.equal((await h.query("SELECT status FROM giveaway WHERE oid = $1", [oid]))[0].status, "Draft");
        await assert_balanced(b1);
        await assert_balanced(b2);
    });

    it("cancels only a draft, and a given gift cannot be cancelled", async () => {
        const token = await person();
        const b1 = await batch(5);
        const first = await draft(token, [{ inventory_oid: b1, quantity: 1 }]);
        assert.equal((await h.call(CANCEL, { body: { oid: first, reason: "Changed my mind" }, token })).status, 200);
        assert.equal((await h.call(GIVE, { body: { oid: first }, token })).status, 409);
        const second = await draft(token, [{ inventory_oid: b1, quantity: 1 }]);
        await h.call(GIVE, { body: { oid: second }, token });
        assert.equal((await h.call(CANCEL, { body: { oid: second, reason: "Mistake" }, token })).status, 409);
        assert.equal(await on_hand(b1), 4);
    });

    it("records a repeated save once, and links the customer whose phone it is", async () => {
        const token = await person();
        const b1 = await batch(5);
        const customer = uuidv4();
        await h.query("INSERT INTO customers (oid, name, phone, phone_normalized) VALUES ($1, 'Person A', '01987654321', '01987654321')", [customer]);
        const oid = uuidv4();
        const body = { oid, recipient_name: "Person A", recipient_phone: "01987-654321", note: "Thank you", lines: [{ inventory_oid: b1, quantity: 1 }] };
        const first = await h.call(CREATE, { body, token });
        const again = await h.call(CREATE, { body, token });
        assert.equal(again.body.data.giveaway_no, first.body.data.giveaway_no);
        assert.match(first.body.data.giveaway_no, /^GFT-\d{4}-\d{4,}$/);
        assert.deepEqual(await h.query("SELECT customer_oid, recipient_phone FROM giveaway"), [{ customer_oid: customer, recipient_phone: "01987654321" }]);
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM giveaway_line"))[0].n, 1);
    });

    it("shows cost only to someone who may see stock value", async () => {
        const token = await person();
        const b1 = await batch(5);
        const oid = await draft(token, [{ inventory_oid: b1, quantity: 2 }]);
        const plain = await get(LIST, token, { include: "stats" });
        assert.equal(plain.body.data.rows[0].cost, undefined);
        assert.equal(plain.body.data.stats.cost_this_month, undefined);
        assert.equal((await h.call(`${DETAILS}/${oid}`, { method: "GET", token })).body.data.lines[0].cost_price, undefined);
        const owner = await person([...ALL, "inventory.stock-value.view"]);
        assert.equal((await get(LIST, owner)).body.data.rows[0].cost, 1400);
        const details = await h.call(`${DETAILS}/${oid}`, { method: "GET", token: owner });
        assert.equal(details.body.data.lines[0].cost_price, 700);
        assert.equal(details.body.data.activity[0].title, "Giveaway saved");
    });

    it("needs its own permission for every action", async () => {
        const viewer = await person(["sales.giveaway.view"]);
        const b1 = await batch(5);
        const oid = await draft(await person(), [{ inventory_oid: b1, quantity: 1 }]);
        assert.equal((await h.call(CREATE, { body: { oid: uuidv4(), recipient_name: "X", note: "Y", lines: [{ inventory_oid: b1, quantity: 1 }] }, token: viewer })).status, 403);
        assert.equal((await h.call(GIVE, { body: { oid }, token: viewer })).status, 403);
        assert.equal((await h.call(CANCEL, { body: { oid, reason: "No" }, token: viewer })).status, 403);
        assert.equal((await get(LIST, await person(["sales.order.view"]))).status, 403);
    });
});
