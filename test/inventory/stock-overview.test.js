const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { execute_transaction } = require("../../src/db/database");
const { holdStock } = require("../../src/routes/sales/utils/stock-movement");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const PO = CONTEXTS.INVENTORY + SUB_CONTEXTS.PURCHASE_ORDER;
const OVERVIEW = CONTEXTS.INVENTORY + SUB_CONTEXTS.INVENTORY_OVERVIEW;
const LIST = OVERVIEW + ROUTES.GET_STOCK_OVERVIEW_LIST;
const STOCK = OVERVIEW + ROUTES.GET_PRODUCT_STOCK;
const PRICING = OVERVIEW + ROUTES.UPDATE_BATCH_PRICING;
const BUDGET = OVERVIEW + ROUTES.UPDATE_BATCH_BUDGET;
const EXPIRY = PO + ROUTES.UPDATE_BATCH_EXPIRY;

const RECEIVER = ["view", "create", "approve"].map((action) => `inventory.purchase-order.${action}`);
const OWNER = ["inventory.overview.view", "inventory.overview.edit", "inventory.stock-value.view"];
const STAFF = ["inventory.overview.view"];
const USER = "owner@arithmalabs.test";

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `so-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;

// A cream for sale (10 at 300, priced 500 with up to 50 off, 20 packaging per unit) and a bag kept
// for internal use (5 at 100), received through one real purchase order. Two creams are then held.
const seed = async () => {
    await h.query("TRUNCATE stock_movement, purchase, purchase_details, cost_budget, inventory, stock_hold, order_items, orders, product, sub_categories, categories, brands, aisle, warehouse, supplier, activity_log CASCADE");
    const ids = { category: uuidv4(), sub_category: uuidv4(), cream: uuidv4(), bag: uuidv4(), main: uuidv4(), supplier: uuidv4() };
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Skincare', 'SKIN', 'Active')", [ids.category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Creams', 'CREA', $2, 'Active')", [ids.sub_category, ids.category]);
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Sun cream', 'SUN', $2, $3, 5, 'Active')", [ids.cream, ids.category, ids.sub_category]);
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Tote bag', 'TOTE', $2, $3, 2, 'Active')", [ids.bag, ids.category, ids.sub_category]);
    await h.query("INSERT INTO warehouse (oid, name, code, status) VALUES ($1, 'Main', 'MAIN', 'Active')", [ids.main]);
    await h.query("INSERT INTO supplier (oid, name, phone_number, status) VALUES ($1, 'Beauty house', '01711000000', 'Active')", [ids.supplier]);

    const token = await sign_in_with(RECEIVER);
    const products = [
        { product_oid: ids.cream, warehouse_oid: ids.main, aisle_oid: null, quantity: 10, unit_price: 300 },
        { product_oid: ids.bag, warehouse_oid: ids.main, aisle_oid: null, quantity: 5, unit_price: 100 },
    ];
    const created = await post(PO + ROUTES.CREATE_PURCHASE, token, { supplier_oid: ids.supplier, purchase_type: "advance", payment_status: "unpaid", paid_amount: 0, products });
    ids.purchase = created.body.data.oid;
    const { lines } = (await get(`${PO + ROUTES.GET_PURCHASE_DETAILS}/${ids.purchase}`, token)).body.data;
    const line = (product) => lines.find((l) => l.product_oid === product);
    const verified = await post(PO + ROUTES.VERIFY_PURCHASE, token, {
        oid: ids.purchase,
        lines: [
            { oid: line(ids.cream).oid, received_quantity: 10, unit_price: 300, intended_use: "for_sale", selling_price: 500, maximum_discount: 50, packaging_cost: 20 },
            { oid: line(ids.bag).oid, received_quantity: 5, unit_price: 100, intended_use: "internal_use" },
        ],
    });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    const batches = await h.query("SELECT oid, product_oid, batch_code FROM inventory");
    ids.cream_batch = batches.find((b) => b.product_oid === ids.cream);
    ids.bag_batch = batches.find((b) => b.product_oid === ids.bag);

    const order = uuidv4();
    await h.query("INSERT INTO orders (oid, invoice_no, total_amount) VALUES ($1, 'INV-1', 0)", [order]);
    await execute_transaction((tx) => holdStock(tx, { order_oid: order, product_oid: ids.cream, inventory_oid: ids.cream_batch.oid, quantity: 2, user_id: USER }));
    return ids;
};

const MONEY = ["stock_value", "expected_revenue", "profit_full", "profit_discounted", "internal_value", "expiring_value", "cost_price", "budget_per_unit", "margin_per_unit", "packaging_cost"];

describe("the stock overview list", () => {
    let ids;
    beforeEach(async () => {
        await h.reset();
        ids = await seed();
    });

    it("adds each product's batches up, profit per batch with budgets, internal use valued but never sellable", async () => {
        const res = await get(LIST, await sign_in_with(OWNER), { include: "stats" });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const row = (oid) => res.body.data.rows.find((r) => r.oid === oid);
        const cream = row(ids.cream);
        assert.deepEqual(
            { on_hand: cream.on_hand, held: cream.held, sellable: cream.sellable, batches: cream.batches, stock_value: Number(cream.stock_value), expected_revenue: Number(cream.expected_revenue), profit_full: Number(cream.profit_full), profit_discounted: Number(cream.profit_discounted), stock_status: cream.stock_status },
            { on_hand: 10, held: 2, sellable: 8, batches: 1, stock_value: 3000, expected_revenue: 5000, profit_full: 1800, profit_discounted: 1300, stock_status: "in" },
        );
        const bag = row(ids.bag);
        assert.deepEqual({ sellable: bag.sellable, stock_value: Number(bag.stock_value), internal_value: Number(bag.internal_value), expected_revenue: Number(bag.expected_revenue), stock_status: bag.stock_status }, { sellable: 0, stock_value: 500, internal_value: 500, expected_revenue: 0, stock_status: "out" });

        const { stats } = res.body.data;
        assert.deepEqual({ on_hand: stats.on_hand, out: stats.out, stock_value: Number(stats.stock_value), profit_full: Number(stats.profit_full) }, { on_hand: 15, out: 1, stock_value: 3500, profit_full: 1800 });
    });

    it("sends Staff quantities only: no money in any row or figure, and no sorting by a hidden figure", async () => {
        const staff = await sign_in_with(STAFF);
        const res = await get(LIST, staff, { include: "stats", sort: "profit_full", order: "desc" });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        for (const row of res.body.data.rows) assert.deepEqual(MONEY.filter((key) => key in row), []);
        assert.deepEqual(MONEY.filter((key) => key in res.body.data.stats), []);
        assert.deepEqual(res.body.data.rows.map((r) => r.name), ["Sun cream", "Tote bag"], "falls back to name order");
    });

    it("keeps an Inactive product's stock on the list, and finds a product by its batch code", async () => {
        await h.query("UPDATE product SET status = 'Inactive' WHERE oid = $1", [ids.bag]);
        const token = await sign_in_with(OWNER);
        assert.equal((await get(LIST, token)).body.total, 2);
        const found = await get(LIST, token, { search: ids.cream_batch.batch_code });
        assert.deepEqual(found.body.data.rows.map((r) => r.oid), [ids.cream]);
    });

    it("filters by stock status", async () => {
        const out = await get(LIST, await sign_in_with(OWNER), { stock_status: "out" });
        assert.deepEqual(out.body.data.rows.map((r) => r.oid), [ids.bag]);
    });

    it("refuses someone without the view permission, and without a sign in", async () => {
        assert.equal((await get(LIST, await sign_in_with(["inventory.purchase-order.view"]))).status, 403);
        assert.equal((await get(LIST, null)).status, 401);
    });
});

describe("a product's stock page", () => {
    let ids;
    beforeEach(async () => {
        await h.reset();
        ids = await seed();
    });

    it("shows each batch with where it came from, its budget and its margin per unit", async () => {
        const res = await get(`${STOCK}/${ids.cream}`, await sign_in_with(OWNER));
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const [batch] = res.body.data.batches;
        assert.deepEqual(
            { supplier: batch.supplier_name, warehouse: batch.warehouse_name, budget: Number(batch.budget_per_unit), margin: Number(batch.margin_per_unit), sellable: batch.sellable, po: !!batch.po_number, value: batch.stock_value, revenue: batch.expected_revenue, profit: batch.profit_full },
            { supplier: "Beauty house", warehouse: "Main", budget: 20, margin: 180, sellable: 8, po: true, value: 3000, revenue: 5000, profit: 1800 },
        );
        assert.equal(Number(res.body.data.figures.profit_full), 1800);
        assert.equal(res.body.data.sees_money, true);
    });

    it("leaves buying price, budgets and profit out for Staff, and keeps the selling price", async () => {
        const res = await get(`${STOCK}/${ids.cream}`, await sign_in_with(STAFF));
        const [batch] = res.body.data.batches;
        assert.deepEqual(MONEY.filter((key) => key in batch || key in res.body.data.figures), []);
        assert.equal(Number(batch.selling_price), 500);
        assert.equal(res.body.data.sees_money, false);

        await post(BUDGET, await sign_in_with(OWNER), { inventory_oid: ids.cream_batch.oid, ad_run_cost: 30, packaging_cost: 20 });
        const after = await get(`${STOCK}/${ids.cream}`, await sign_in_with(STAFF));
        assert.deepEqual(after.body.data.activity.filter((a) => a.action === "Budget changed"), [], "a budget change names a cost");
    });

    it("answers 404 for a product that does not exist", async () => {
        assert.equal((await get(`${STOCK}/${uuidv4()}`, await sign_in_with(OWNER))).status, 404);
    });
});

describe("changing a batch's price and budget", () => {
    let ids;
    let token;
    beforeEach(async () => {
        await h.reset();
        ids = await seed();
        token = await sign_in_with(OWNER);
    });

    const movements = async () => (await h.query("SELECT count(*)::int AS n FROM stock_movement"))[0].n;

    it("saves a new price, logs the old and new, and moves no stock", async () => {
        const before = await movements();
        const res = await post(PRICING, token, { inventory_oid: ids.cream_batch.oid, selling_price: 550, maximum_discount: 30 });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const [batch] = await h.query("SELECT selling_price::int AS price, maximum_discount::int AS discount, quantity_available::int AS on_hand FROM inventory WHERE oid = $1", [ids.cream_batch.oid]);
        assert.deepEqual(batch, { price: 550, discount: 30, on_hand: 10 });
        const [log] = await h.query("SELECT description FROM activity_log WHERE reference_type = 'product-stock' AND reference_oid = $1", [ids.cream]);
        assert.match(log.description, /500, up to 50 off to 550, up to 30 off/);
        assert.equal(await movements(), before);
    });

    it("writes nothing when the price is the same", async () => {
        const res = await post(PRICING, token, { inventory_oid: ids.cream_batch.oid, selling_price: 500, maximum_discount: 50 });
        assert.equal(res.body.data.changed, false);
    });

    it("refuses a price for internal use stock, so packaging never becomes sellable", async () => {
        const res = await post(PRICING, token, { inventory_oid: ids.bag_batch.oid, selling_price: 50, maximum_discount: 0 });
        assert.equal(res.status, 409);
        const [batch] = await h.query("SELECT status FROM inventory WHERE oid = $1", [ids.bag_batch.oid]);
        assert.equal(batch.status, "internal_use");
    });

    it("refuses a price of 0 and a discount above the price", async () => {
        assert.equal((await post(PRICING, token, { inventory_oid: ids.cream_batch.oid, selling_price: 0, maximum_discount: 0 })).status, 400);
        assert.equal((await post(PRICING, token, { inventory_oid: ids.cream_batch.oid, selling_price: 100, maximum_discount: 150 })).status, 400);
    });

    it("refuses a budget change to an editor who may not see money", async () => {
        const editor = await sign_in_with(["inventory.overview.view", "inventory.overview.edit"]);
        assert.equal((await post(BUDGET, editor, { inventory_oid: ids.cream_batch.oid, packaging_cost: 5 })).status, 403);
    });

    it("refuses Staff, who may see the page but not change it", async () => {
        const staff = await sign_in_with(STAFF);
        assert.equal((await post(PRICING, staff, { inventory_oid: ids.cream_batch.oid, selling_price: 550, maximum_discount: 0 })).status, 403);
        assert.equal((await post(BUDGET, staff, { inventory_oid: ids.cream_batch.oid, packaging_cost: 5 })).status, 403);
    });

    it("saves budgets per unit, which the profit then reflects, and logs what changed", async () => {
        const res = await post(BUDGET, token, { inventory_oid: ids.cream_batch.oid, ad_run_cost: 30, packaging_cost: 20 });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const figures = (await get(`${STOCK}/${ids.cream}`, token)).body.data.figures;
        assert.equal(Number(figures.profit_full), 10 * (500 - 300 - 50));
        const [log] = await h.query("SELECT description FROM activity_log WHERE title = 'Budget changed'");
        assert.match(log.description, /ad changed/);
        assert.doesNotMatch(log.description, /30/, "the activity log never carries a budget amount");
        assert.equal(await movements(), 2, "a budget moves no stock");
        assert.equal((await post(BUDGET, token, { inventory_oid: ids.cream_batch.oid, ad_run_cost: 30, packaging_cost: 20 })).body.data.changed, false);
    });

    it("never changes a batch's unit cost, which is fixed once verified", async () => {
        const res = await post(BUDGET, token, { inventory_oid: ids.cream_batch.oid, cost_price: 330, packaging_cost: 20 });
        assert.equal(res.status, 400, "a unit cost is not something this route accepts");
        const [batch] = await h.query("SELECT cost_price::int AS cost FROM inventory WHERE oid = $1", [ids.cream_batch.oid]);
        assert.equal(batch.cost, 300);
    });

    it("lets someone who may edit the stock overview change a batch's expiry", async () => {
        await h.query("UPDATE product SET has_expiry = true WHERE oid = $1", [ids.cream]);
        const res = await post(EXPIRY, token, { inventory_oid: ids.cream_batch.oid, expiry_date: "2027-03-31" });
        assert.equal(res.status, 200, JSON.stringify(res.body));
    });
});

describe("a product's stock report", () => {
    const REPORT = OVERVIEW + ROUTES.GENERATE_PRODUCT_STOCK_REPORT;
    const EXPORTER = [...OWNER, "inventory.overview.export"];

    // The rows under the column titles, as values, read back from the file the server sent.
    const download = async (token, oid) => {
        const res = await fetch(`${h.url()}${REPORT}/${oid}`, { headers: { authorization: `Bearer ${token}` } });
        const workbook = new ExcelJS.Workbook();
        if (res.status === 200) await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
        const sheet = workbook.getWorksheet("Stock");
        const rows = [];
        sheet?.eachRow((row) => rows.push(row.values.slice(1)));
        const head = rows.findIndex((r) => r[0] === "Batch code");
        return { status: res.status, filename: res.headers.get("x-filename"), titles: rows[head], rows: rows.slice(head + 1) };
    };

    let ids;
    beforeEach(async () => (ids = await seed()));

    it("writes each batch holding stock with its figures, and the product totals, for someone who may see money", async () => {
        const report = await download(await sign_in_with(EXPORTER), ids.cream);
        assert.equal(report.status, 200);
        assert.match(decodeURIComponent(report.filename), /^SUN_stock_report_\d{4}-\d{2}-\d{2}\.xlsx$/);
        const col = (name) => report.titles.indexOf(name);
        const batch = report.rows[0];
        assert.equal(batch[col("Batch code")], ids.cream_batch.batch_code);
        assert.deepEqual([batch[col("On hand")], batch[col("Held")], batch[col("Sellable")]], [10, 2, 8]);
        assert.deepEqual([batch[col("Selling price")], batch[col("Max discount")], batch[col("Cost price")], batch[col("Budget per unit")]], [500, 50, 300, 20]);
        assert.deepEqual([batch[col("Stock value")], batch[col("Probable revenue")], batch[col("Probable profit")]], [3000, 5000, 1800]);
        const total = (label) => report.rows.find((r) => r[0] === label)?.[1];
        assert.deepEqual([total("On hand"), total("Held for orders"), total("Sellable")], [10, 2, 8]);
        assert.deepEqual([total("Stock value at cost"), total("Probable profit at full price"), total("Probable profit at full discount")], [3000, 1800, 1300]);
    });

    it("leaves cost, value and profit out of the file for someone who may not see money", async () => {
        const report = await download(await sign_in_with(["inventory.overview.view", "inventory.overview.export"]), ids.cream);
        assert.equal(report.status, 200);
        for (const title of ["Cost price", "Budget per unit", "Stock value", "Probable revenue", "Probable profit"]) assert.ok(!report.titles.includes(title), title);
        assert.ok(!report.rows.some((r) => /value|profit|revenue/i.test(String(r[0]))));
        assert.equal(report.rows[0][report.titles.indexOf("Selling price")], 500);
    });

    it("is refused without the export permission, and without a sign in", async () => {
        assert.equal((await download(await sign_in_with(OWNER), ids.cream)).status, 403);
        assert.equal((await h.call(`${REPORT}/${ids.cream}`, { method: "GET" })).status, 401);
    });

    it("answers 404 for a product that does not exist", async () => {
        assert.equal((await download(await sign_in_with(EXPORTER), uuidv4())).status, 404);
    });
});
