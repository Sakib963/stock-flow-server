const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { execute_transaction } = require("../../src/db/database");
const { deductSellableStock, holdStock, deductHeldStock, restockStock, deductStock, releaseHolds } = require("../../src/routes/sales/utils/stock-movement");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const PO = CONTEXTS.INVENTORY + SUB_CONTEXTS.PURCHASE_ORDER;
const CREATE = PO + ROUTES.CREATE_PURCHASE;
const DETAILS = PO + ROUTES.GET_PURCHASE_DETAILS;
const VERIFY = PO + ROUTES.VERIFY_PURCHASE;
const LIST = CONTEXTS.INVENTORY + SUB_CONTEXTS.STOCK_MOVEMENT + ROUTES.GET_STOCK_MOVEMENT_LIST;

const PO_RIGHTS = ["view", "create", "approve"].map((action) => `inventory.purchase-order.${action}`);
const USER = "owner@arithmalabs.test";

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `sm-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;

const seed = async () => {
    await h.query("TRUNCATE stock_movement, purchase, purchase_details, cost_budget, inventory, stock_hold, order_items, orders, product, sub_categories, categories, aisle, warehouse, supplier CASCADE");
    const ids = { category: uuidv4(), sub_category: uuidv4(), kurti: uuidv4(), main: uuidv4(), supplier: uuidv4() };
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [ids.category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Tops', 'TOPS', $2, 'Active')", [ids.sub_category, ids.category]);
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Cotton kurti', 'KURTI', $2, $3, 20, 'Active')", [ids.kurti, ids.category, ids.sub_category]);
    await h.query("INSERT INTO warehouse (oid, name, code, status) VALUES ($1, 'Main', 'MAIN', 'Active')", [ids.main]);
    await h.query("INSERT INTO supplier (oid, name, phone_number, status) VALUES ($1, 'Garment house', '01711000000', 'Active')", [ids.supplier]);
    return ids;
};

// A batch of 50 kurtis, received through a real purchase order.
const receive = async (ids, token) => {
    const created = await post(CREATE, token, { supplier_oid: ids.supplier, purchase_type: "advance", payment_status: "unpaid", paid_amount: 0, products: [{ product_oid: ids.kurti, warehouse_oid: ids.main, aisle_oid: null, quantity: 50, unit_price: 450 }] });
    const oid = created.body.data.oid;
    const [line] = (await get(`${DETAILS}/${oid}`, token)).body.data.lines;
    const verified = await post(VERIFY, token, { oid, lines: [{ oid: line.oid, received_quantity: 50, unit_price: 450, intended_use: "for_sale", selling_price: 890, maximum_discount: 50 }] });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    const [batch] = await h.query("SELECT oid FROM inventory");
    return { purchase_oid: oid, batch: batch.oid };
};

const movements = (batch) => h.query("SELECT reason, quantity, balance_after, source_oid FROM stock_movement WHERE inventory_oid = $1 ORDER BY created_on, oid", [batch]);

// The one rule the ledger lives by: a batch's rows add up to what it holds, and the last balance says the same.
const assert_balanced = async (batch) => {
    const [{ held }] = await h.query("SELECT quantity_available::int AS held FROM inventory WHERE oid = $1", [batch]);
    const rows = await movements(batch);
    assert.equal(
        rows.reduce((sum, row) => sum + row.quantity, 0),
        held,
    );
    assert.equal(rows.at(-1).balance_after, held);
};

const an_order = async () => {
    const oid = uuidv4();
    await h.query("INSERT INTO orders (oid, invoice_no, total_amount) VALUES ($1, $2, 0)", [oid, `INV-${oid.slice(0, 6)}`]);
    return oid;
};

describe("the stock movement ledger", () => {
    let ids;
    let token;
    let received;

    beforeEach(async () => {
        await h.reset();
        ids = await seed();
        token = await sign_in_with(PO_RIGHTS);
        received = await receive(ids, token);
    });

    it("records a received batch with its purchase order, and nothing else", async () => {
        assert.deepEqual(await movements(received.batch), [{ reason: "received", quantity: 50, balance_after: 50, source_oid: received.purchase_oid }]);
    });

    it("records a counter sale as stock out, against the order", async () => {
        const order = await an_order();
        await execute_transaction((tx) => deductSellableStock(tx, { inventory_oid: received.batch, quantity: 3, order_oid: order, user_id: USER }));
        assert.deepEqual((await movements(received.batch)).at(-1), { reason: "sold", quantity: -3, balance_after: 47, source_oid: order });
        await assert_balanced(received.batch);
    });

    it("records nothing for a hold, and the dispatch that follows as stock out", async () => {
        const order = await an_order();
        await execute_transaction((tx) => holdStock(tx, { order_oid: order, product_oid: ids.kurti, inventory_oid: received.batch, quantity: 4, user_id: USER }));
        assert.equal((await movements(received.batch)).length, 1);

        await execute_transaction((tx) => deductHeldStock(tx, { order_oid: order, user_id: USER }));
        assert.deepEqual((await movements(received.batch)).at(-1), { reason: "dispatched", quantity: -4, balance_after: 46, source_oid: order });
        await assert_balanced(received.batch);
    });

    it("records nothing when an online order is cancelled before dispatch, since the shelf never changed", async () => {
        const order = await an_order();
        await execute_transaction((tx) => holdStock(tx, { order_oid: order, product_oid: ids.kurti, inventory_oid: received.batch, quantity: 4, user_id: USER }));
        await execute_transaction((tx) => releaseHolds(tx, { order_oid: order, user_id: USER }));
        assert.equal((await movements(received.batch)).length, 1);
    });

    it("records a good return as stock back in, against the return", async () => {
        const return_oid = uuidv4();
        await execute_transaction((tx) => restockStock(tx, { inventory_oid: received.batch, quantity: 2, reason: "returned", source_oid: return_oid, user_id: USER }));
        assert.deepEqual((await movements(received.batch)).at(-1), { reason: "returned", quantity: 2, balance_after: 52, source_oid: return_oid });
        await assert_balanced(received.batch);
    });

    it("records a disposal and its reversal as out and back in", async () => {
        const dispose_oid = uuidv4();
        await execute_transaction((tx) => deductStock(tx, { inventory_oid: received.batch, quantity: 5, reason: "disposed", source_oid: dispose_oid, user_id: USER }));
        await execute_transaction((tx) => restockStock(tx, { inventory_oid: received.batch, quantity: 5, reason: "dispose_reversed", source_oid: dispose_oid, user_id: USER }));
        const rows = (await movements(received.batch)).slice(1).map((row) => [row.reason, row.quantity, row.balance_after]);
        assert.deepEqual(rows, [
            ["disposed", -5, 45],
            ["dispose_reversed", 5, 50],
        ]);
        await assert_balanced(received.batch);
    });

    it("records nothing when stock is refused for want of it", async () => {
        const refused = await execute_transaction((tx) => deductStock(tx, { inventory_oid: received.batch, quantity: 51, reason: "disposed", source_oid: uuidv4(), user_id: USER }));
        assert.equal(refused, false);
        assert.equal((await movements(received.batch)).length, 1);
    });

    it("rolls the movement back with the sale when the sale fails later in the same transaction", async () => {
        const failing = execute_transaction(async (tx) => {
            await deductSellableStock(tx, { inventory_oid: received.batch, quantity: 3, order_oid: uuidv4(), user_id: USER });
            throw new Error("payment step failed");
        });
        await assert.rejects(failing);
        assert.equal((await movements(received.batch)).length, 1);
        await assert_balanced(received.batch);
    });

    it("keeps two sales at the same moment apart: each has its own balance and the batch still adds up", async () => {
        const sell = () => execute_transaction((tx) => deductSellableStock(tx, { inventory_oid: received.batch, quantity: 10, order_oid: uuidv4(), user_id: USER }));
        await Promise.all([sell(), sell()]);
        const balances = (await movements(received.batch)).slice(1).map((row) => row.balance_after);
        assert.deepEqual(balances.sort(), [30, 40]);
        await assert_balanced(received.batch);
    });
});

describe("the stock movement list", () => {
    it("shows each movement with its product, batch, warehouse and purchase order", async () => {
        await h.reset();
        const ids = await seed();
        const token = await sign_in_with([...PO_RIGHTS, "inventory.stock-movement.view"]);
        const received = await receive(ids, token);
        const [{ po_number }] = await h.query("SELECT po_number FROM purchase");

        const res = await get(LIST, token, { include: "stats" });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const [row] = res.body.data.rows;
        assert.equal(res.body.total, 1);
        const shown = { reason: row.reason, quantity: row.quantity, balance_after: row.balance_after, product_name: row.product_name, warehouse_name: row.warehouse_name, reference: row.reference, purchase_oid: row.purchase_oid };
        assert.deepEqual(shown, { reason: "received", quantity: 50, balance_after: 50, product_name: "Cotton kurti", warehouse_name: "Main", reference: po_number, purchase_oid: received.purchase_oid });
        assert.deepEqual(res.body.data.stats, { units_in: 50, units_out: 0 });
    });

    it("does not count a carried over balance as stock that came in", async () => {
        await h.reset();
        const ids = await seed();
        const token = await sign_in_with([...PO_RIGHTS, "inventory.stock-movement.view"]);
        const received = await receive(ids, token);
        await h.query("INSERT INTO stock_movement (oid, inventory_oid, product_oid, quantity, balance_after, reason) VALUES ($1, $2, $3, 12, 62, 'carried_over')", [uuidv4(), received.batch, ids.kurti]);

        assert.deepEqual((await get(LIST, token, { include: "stats" })).body.data.stats, { units_in: 50, units_out: 0 });
    });

    it("finds a movement by its batch code, and filters by reason and product", async () => {
        await h.reset();
        const ids = await seed();
        const token = await sign_in_with([...PO_RIGHTS, "inventory.stock-movement.view"]);
        const received = await receive(ids, token);
        await execute_transaction((tx) => deductSellableStock(tx, { inventory_oid: received.batch, quantity: 3, order_oid: uuidv4(), user_id: USER }));
        const [{ batch_code }] = await h.query("SELECT batch_code FROM inventory");

        assert.equal((await get(LIST, token, { search: batch_code })).body.total, 2);
        assert.equal((await get(LIST, token, { reason: "sold" })).body.data.rows[0].quantity, -3);
        assert.equal((await get(LIST, token, { product_oid: ids.kurti })).body.total, 2);
    });

    it("refuses the list to someone without the permission, and without a sign in", async () => {
        await h.reset();
        const token = await sign_in_with(["inventory.purchase-order.view"]);
        assert.equal((await get(LIST, token)).status, 403);
        assert.equal((await get(LIST, null)).status, 401);
    });
});
