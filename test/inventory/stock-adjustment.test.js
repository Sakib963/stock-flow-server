const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { execute_transaction } = require("../../src/db/database");
const { holdStock } = require("../../src/routes/sales/utils/stock-movement");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.INVENTORY + SUB_CONTEXTS.STOCK_ADJUSTMENT;
const LIST = BASE + ROUTES.GET_STOCK_ADJUSTMENT_LIST;
const DETAILS = BASE + ROUTES.GET_STOCK_ADJUSTMENT_DETAILS;
const CREATE = BASE + ROUTES.CREATE_STOCK_ADJUSTMENT;
const UPDATE = BASE + ROUTES.UPDATE_STOCK_ADJUSTMENT;
const VERIFY = BASE + ROUTES.VERIFY_STOCK_ADJUSTMENT;
const REJECT = BASE + ROUTES.REJECT_STOCK_ADJUSTMENT;
const CANCEL = BASE + ROUTES.CANCEL_STOCK_ADJUSTMENT;
const REPORT = BASE + ROUTES.GENERATE_STOCK_ADJUSTMENT_REPORT;

const ALL = ["view", "create", "edit", "approve", "reject", "cancel", "export"].map((action) => `inventory.stock-adjustment.${action}`);
const OWNER = [...ALL, "inventory.stock-value.view"];
const USER = "owner@arithmalabs.test";

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `sa-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;

const movements = (batch) => h.query("SELECT quantity, balance_after, reason, source_oid FROM stock_movement WHERE inventory_oid = $1 ORDER BY created_on, oid", [batch]);
const on_hand = async (batch) => (await h.query("SELECT quantity_available::int AS q FROM inventory WHERE oid = $1", [batch]))[0].q;

// A batch's movement rows always add up to what it holds (CLAUDE.md, the stock movement ledger).
const assert_balanced = async (batch) => {
    const rows = await movements(batch);
    const held = await on_hand(batch);
    assert.equal(
        rows.reduce((sum, row) => sum + row.quantity, 0),
        held,
    );
    assert.equal(rows.at(-1).balance_after, held);
};

let ids;
let token;

const seed = async () => {
    await h.query("TRUNCATE stock_adjustment_line, stock_adjustment, stock_movement, purchase, purchase_details, cost_budget, inventory, stock_hold, order_items, orders, product, sub_categories, categories, brands, aisle, warehouse, supplier, activity_log CASCADE");
    const ids = { category: uuidv4(), sub_category: uuidv4(), cream: uuidv4(), main: uuidv4(), shelf: uuidv4() };
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Skincare', 'SKIN', 'Active')", [ids.category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Creams', 'CREA', $2, 'Active')", [ids.sub_category, ids.category]);
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Sun cream', 'SUN', $2, $3, 5, 'Active')", [ids.cream, ids.category, ids.sub_category]);
    await h.query("INSERT INTO warehouse (oid, name, code, status) VALUES ($1, 'Main', 'MAIN', 'Active')", [ids.main]);
    await h.query("INSERT INTO aisle (oid, name, code, warehouse_oid, status) VALUES ($1, 'Shelf A', 'A', $2, 'Active')", [ids.shelf, ids.main]);
    return ids;
};

const OPENING_LINE = () => ({ product_oid: ids.cream, quantity: 10, cost_price: 300, intended_use: "for_sale", selling_price: 500, maximum_discount: 50, warehouse_oid: ids.main, aisle_oid: ids.shelf });

// Loads 10 creams as opening stock, verified, and returns the batch it made.
const opening_batch = async () => {
    const created = await post(CREATE, token, { reason: "opening_stock", lines: [OPENING_LINE()] });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal((await post(VERIFY, token, { oid: created.body.data.oid })).status, 200);
    const [line] = await h.query("SELECT inventory_oid FROM stock_adjustment_line WHERE adjustment_oid = $1", [created.body.data.oid]);
    return line.inventory_oid;
};

beforeEach(async () => {
    await h.reset();
    ids = await seed();
    token = await sign_in_with(OWNER);
});

describe("loading opening stock", () => {
    it("moves nothing when saved as a draft or submitted, and only on verify creates the batch with its code, place and movement", async () => {
        const draft = await post(CREATE, token, { draft: true, reason: "opening_stock", lines: [{ product_oid: ids.cream }] });
        assert.equal(draft.status, 200, JSON.stringify(draft.body));
        assert.equal(draft.body.data.status, "Draft");
        assert.match(draft.body.data.adjustment_number, /^ADJ-\d{4}-\d{4}$/);
        const oid = draft.body.data.oid;

        assert.equal((await post(VERIFY, token, { oid })).status, 409, "a draft cannot be verified");
        const submitted = await post(UPDATE, token, { oid, reason: "opening_stock", lines: [OPENING_LINE()] });
        assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
        assert.equal(submitted.body.data.status, "Submitted");
        assert.equal((await h.query("SELECT count(*)::int n FROM inventory"))[0].n, 0, "submitting moves nothing");

        const verified = await post(VERIFY, token, { oid });
        assert.equal(verified.status, 200, JSON.stringify(verified.body));
        const [batch] = await h.query("SELECT oid, batch_code, quantity_available::int q, warehouse_oid, aisle_oid, purchase_details_oid, status, selling_price::int sp FROM inventory");
        assert.match(batch.batch_code, /^B-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        assert.deepEqual([batch.q, batch.warehouse_oid, batch.aisle_oid, batch.purchase_details_oid, batch.status, batch.sp], [10, ids.main, ids.shelf, null, "ready_for_sale", 500]);
        assert.deepEqual(await movements(batch.oid), [{ quantity: 10, balance_after: 10, reason: "opening_stock", source_oid: oid }]);
        await assert_balanced(batch.oid);
    });

    it("refuses to submit a new batch without its cost, warehouse or selling price, naming the line", async () => {
        const missing = await post(CREATE, token, { reason: "opening_stock", lines: [{ ...OPENING_LINE(), warehouse_oid: null }] });
        assert.equal(missing.status, 400);
        assert.match(missing.body.message, /^Line 1: choose the warehouse/);
        const unpriced = await post(CREATE, token, { reason: "opening_stock", lines: [{ ...OPENING_LINE(), selling_price: null }] });
        assert.equal(unpriced.status, 400);
    });

    it("keeps a new batch's budgets through a draft, gives them to the batch on verify, and lets the stock overview change them but never the cost", async () => {
        const OVERVIEW = CONTEXTS.INVENTORY + SUB_CONTEXTS.INVENTORY_OVERVIEW;
        const draft = await post(CREATE, token, { draft: true, reason: "opening_stock", lines: [{ ...OPENING_LINE(), ad_run_cost: 30, packaging_cost: 20, cost_remarks: "Boosted post" }] });
        assert.equal(draft.status, 200, JSON.stringify(draft.body));
        const oid = draft.body.data.oid;
        const kept = await post(UPDATE, token, { oid, reason: "opening_stock", lines: [{ ...OPENING_LINE(), quantity: 12, ad_run_cost: 30, packaging_cost: 20, cost_remarks: "Boosted post" }] });
        assert.equal(kept.status, 200, JSON.stringify(kept.body));
        const [line] = (await get(`${DETAILS}/${oid}`, token)).body.data.lines;
        assert.deepEqual([Number(line.ad_run_cost), Number(line.packaging_cost), line.cost_remarks], [30, 20, "Boosted post"]);
        assert.equal((await h.query("SELECT count(*)::int AS n FROM cost_budget"))[0].n, 1, "the replaced line took its budget with it");

        assert.equal((await post(VERIFY, token, { oid })).status, 200);
        const [batch] = await h.query("SELECT i.oid, i.stock_adjustment_line_oid = l.oid AS linked FROM inventory i JOIN stock_adjustment_line l ON l.inventory_oid = i.oid WHERE l.adjustment_oid = $1", [oid]);
        assert.equal(batch.linked, true);
        const stock = await get(`${OVERVIEW}${ROUTES.GET_PRODUCT_STOCK}/${ids.cream}`, await sign_in_with(["inventory.overview.view", "inventory.stock-value.view"]));
        assert.equal(Number(stock.body.data.batches[0].budget_per_unit), 50);

        const edited = await post(OVERVIEW + ROUTES.UPDATE_BATCH_BUDGET, await sign_in_with(["inventory.overview.view", "inventory.overview.edit", "inventory.stock-value.view"]), { inventory_oid: batch.oid, ad_run_cost: 40, packaging_cost: 20, cost_remarks: "Boosted post" });
        assert.equal(edited.status, 200, JSON.stringify(edited.body));
        const [after] = await h.query("SELECT i.cost_price::int AS cost, b.ad_run_cost::int AS ad FROM inventory i JOIN cost_budget b ON b.stock_adjustment_line_oid = i.stock_adjustment_line_oid WHERE i.oid = $1", [batch.oid]);
        assert.deepEqual(after, { cost: 300, ad: 40 });
        await assert_balanced(batch.oid);
    });

    it("lets the expiry of a batch an adjustment made be corrected, logged on the product", async () => {
        await h.query("UPDATE product SET has_expiry = true WHERE oid = $1", [ids.cream]);
        const batch = await opening_batch();
        const editor = await sign_in_with(["inventory.overview.view", "inventory.overview.edit"]);
        const res = await post(CONTEXTS.INVENTORY + SUB_CONTEXTS.PURCHASE_ORDER + ROUTES.UPDATE_BATCH_EXPIRY, editor, { inventory_oid: batch, expiry_date: "2027-03-31" });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const [log] = await h.query("SELECT reference_type, description FROM activity_log WHERE title = 'Expiry date changed'");
        assert.equal(log.reference_type, "product-stock");
        assert.match(log.description, /^Sun cream batch /);
    });

    it("drops budgets from a line that moves an existing batch, which keeps its own", async () => {
        const batch = await opening_batch();
        const found = await post(CREATE, token, { reason: "found", lines: [{ product_oid: ids.cream, quantity: 2, inventory_oid: batch, ad_run_cost: 99 }] });
        assert.equal(found.status, 200, JSON.stringify(found.body));
        assert.equal((await h.query("SELECT count(*)::int AS n FROM cost_budget"))[0].n, 0);
    });
});

describe("correcting stock on an existing batch", () => {
    it("adds found units to the batch with an adjusted movement", async () => {
        const batch = await opening_batch();
        const found = await post(CREATE, token, { reason: "found", lines: [{ product_oid: ids.cream, quantity: 3, inventory_oid: batch }] });
        assert.equal((await post(VERIFY, token, { oid: found.body.data.oid })).status, 200);
        assert.equal(await on_hand(batch), 13);
        assert.deepEqual((await movements(batch)).at(-1), { quantity: 3, balance_after: 13, reason: "adjusted", source_oid: found.body.data.oid });
        await assert_balanced(batch);
    });

    it("takes a theft only from units free of holds, refusing at submit and again at verify when a sale got there first", async () => {
        const batch = await opening_batch();
        const order = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, total_amount) VALUES ($1, 'INV-1', 0)", [order]);
        await execute_transaction((tx) => holdStock(tx, { order_oid: order, product_oid: ids.cream, inventory_oid: batch, quantity: 8, user_id: USER }));

        const too_many = await post(CREATE, token, { reason: "theft", lines: [{ product_oid: ids.cream, quantity: 3, inventory_oid: batch }] });
        assert.equal(too_many.status, 400);
        assert.match(too_many.body.message, /has only 2 free/);

        const theft = await post(CREATE, token, { reason: "theft", lines: [{ product_oid: ids.cream, quantity: 2, inventory_oid: batch }] });
        assert.equal(theft.status, 200);
        await execute_transaction((tx) => holdStock(tx, { order_oid: order, product_oid: ids.cream, inventory_oid: batch, quantity: 1, user_id: USER }));
        const late = await post(VERIFY, token, { oid: theft.body.data.oid });
        assert.equal(late.status, 409);
        assert.match(late.body.message, /has only 1 free now/);
        assert.equal(await on_hand(batch), 10, "nothing moved");
        assert.equal((await h.query("SELECT status FROM stock_adjustment WHERE oid = $1", [theft.body.data.oid]))[0].status, "Submitted");
        await assert_balanced(batch);
    });

    it("rolls back every line when one no longer fits", async () => {
        const batch = await opening_batch();
        const adjustment = await post(CREATE, token, {
            reason: "entry_error",
            lines: [
                { product_oid: ids.cream, direction: "in", quantity: 4, inventory_oid: batch },
                { product_oid: ids.cream, direction: "out", quantity: 10, inventory_oid: batch },
            ],
        });
        assert.equal(adjustment.status, 200, JSON.stringify(adjustment.body));
        // Five sell at the counter after it was submitted: 5 + 4 no longer covers the 10 going out.
        await h.query("UPDATE inventory SET quantity_available = 5 WHERE oid = $1", [batch]);
        await h.query("INSERT INTO stock_movement (oid, inventory_oid, product_oid, quantity, balance_after, reason) VALUES ($1, $2, $3, -5, 5, 'sold')", [uuidv4(), batch, ids.cream]);
        const verified = await post(VERIFY, token, { oid: adjustment.body.data.oid });
        assert.equal(verified.status, 409);
        assert.equal(await on_hand(batch), 5, "the first line's 4 were rolled back");
        await assert_balanced(batch);
    });

    it("refuses a theft when an order is holding the same units at that moment, so the order can still be sent", async () => {
        const batch = await opening_batch();
        const theft = await post(CREATE, token, { reason: "theft", lines: [{ product_oid: ids.cream, quantity: 2, inventory_oid: batch }] });
        const order = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, total_amount) VALUES ($1, 'INV-2', 0)", [order]);

        // The order holds all 10 in a transaction that has not committed when the verify starts.
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        let held;
        const holding_started = new Promise((resolve) => (held = resolve));
        const holding = execute_transaction(async (tx) => {
            await holdStock(tx, { order_oid: order, product_oid: ids.cream, inventory_oid: batch, quantity: 10, user_id: USER });
            held();
            await gate;
        });
        await holding_started;
        const verifying = post(VERIFY, token, { oid: theft.body.data.oid });
        await new Promise((resolve) => setTimeout(resolve, 300));
        release();
        await holding;

        assert.equal((await verifying).status, 409);
        assert.equal(await on_hand(batch), 10);
        await assert_balanced(batch);
    });

    it("puts no stock on a product deleted since the adjustment was submitted", async () => {
        const batch = await opening_batch();
        const onto_batch = await post(CREATE, token, { reason: "found", lines: [{ product_oid: ids.cream, quantity: 2, inventory_oid: batch }] });
        const new_batch = await post(CREATE, token, { reason: "found", lines: [{ ...OPENING_LINE(), quantity: 2 }] });
        await h.query("UPDATE inventory SET quantity_available = 0 WHERE oid = $1", [batch]);
        await h.query("INSERT INTO stock_movement (oid, inventory_oid, product_oid, quantity, balance_after, reason) VALUES ($1, $2, $3, -10, 0, 'sold')", [uuidv4(), batch, ids.cream]);
        await h.query("UPDATE product SET is_deleted = TRUE WHERE oid = $1", [ids.cream]);
        for (const adjustment of [onto_batch, new_batch]) {
            const verified = await post(VERIFY, token, { oid: adjustment.body.data.oid });
            assert.equal(verified.status, 409);
            assert.equal(verified.body.data.reason, "product_deleted");
        }
        assert.equal((await h.query("SELECT count(*)::int n FROM inventory"))[0].n, 1, "no new batch");
        await assert_balanced(batch);
    });

    it("moves stock once when two people verify at the same moment", async () => {
        const batch = await opening_batch();
        const lost = await post(CREATE, token, { reason: "lost", lines: [{ product_oid: ids.cream, quantity: 1, inventory_oid: batch }] });
        const other = await sign_in_with(OWNER);
        const results = await Promise.all([post(VERIFY, token, { oid: lost.body.data.oid }), post(VERIFY, other, { oid: lost.body.data.oid })]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        assert.equal(await on_hand(batch), 9);
        await assert_balanced(batch);
    });
});

describe("rejecting, cancelling and editing", () => {
    it("rejects a submitted adjustment with a reason, moves nothing, and it can then be neither verified nor edited", async () => {
        const batch = await opening_batch();
        const lost = await post(CREATE, token, { reason: "lost", lines: [{ product_oid: ids.cream, quantity: 2, inventory_oid: batch }] });
        assert.equal((await post(REJECT, token, { oid: lost.body.data.oid, reason: "" })).status, 400, "a rejection says why");
        assert.equal((await post(REJECT, token, { oid: lost.body.data.oid, reason: "Found them in the back store" })).status, 200);
        assert.equal((await post(VERIFY, token, { oid: lost.body.data.oid })).status, 409);
        assert.equal((await post(UPDATE, token, { oid: lost.body.data.oid, reason: "lost", lines: [{ product_oid: ids.cream, quantity: 1, inventory_oid: batch }] })).status, 409);
        assert.equal(await on_hand(batch), 10);
    });

    it("cancels a draft, keeps a submitted one from going back to a draft, and refuses to reject a draft", async () => {
        const draft = await post(CREATE, token, { draft: true, reason: "found", lines: [] });
        assert.equal((await post(REJECT, token, { oid: draft.body.data.oid, reason: "Not needed" })).status, 409);
        assert.equal((await post(CANCEL, token, { oid: draft.body.data.oid, reason: "Typed by mistake" })).status, 200);

        const submitted = await post(CREATE, token, { reason: "opening_stock", lines: [OPENING_LINE()] });
        assert.equal((await post(UPDATE, token, { oid: submitted.body.data.oid, draft: true, reason: "opening_stock", lines: [OPENING_LINE()] })).status, 409);
    });

    it("writes one activity row for each step", async () => {
        const created = await post(CREATE, token, { reason: "opening_stock", lines: [OPENING_LINE()] });
        await post(VERIFY, token, { oid: created.body.data.oid });
        const rows = await h.query("SELECT title FROM activity_log WHERE reference_type = 'stock-adjustment' AND reference_oid = $1 ORDER BY performed_on", [created.body.data.oid]);
        assert.deepEqual(
            rows.map((r) => r.title),
            ["Submitted", "Verified"],
        );
    });
});

describe("who may do what", () => {
    it("refuses verify without the approve permission, anything without a sign in, and hides values from someone who may not see money", async () => {
        const created = await post(CREATE, token, { reason: "opening_stock", lines: [OPENING_LINE()] });
        const no_approve = await sign_in_with(ALL.filter((code) => code !== "inventory.stock-adjustment.approve"));
        assert.equal((await post(VERIFY, no_approve, { oid: created.body.data.oid })).status, 403);
        assert.equal((await h.call(LIST, { method: "GET" })).status, 401);

        const list = await get(LIST, no_approve, { include: "stats" });
        assert.equal(list.status, 200);
        assert.equal(list.body.data.rows[0].units_in, 10);
        assert.ok(!("value_in" in list.body.data.rows[0]));
        const details = await get(`${DETAILS}/${created.body.data.oid}`, no_approve);
        assert.ok(!("cost_price" in details.body.data.lines[0]));

        const owner_list = await get(LIST, token, { include: "stats" });
        assert.equal(owner_list.body.data.rows[0].value_in, 3000);
        assert.equal(owner_list.body.data.stats.submitted, 1);
    });

    it("lets someone who may only make adjustments pick a warehouse and aisle for a new batch", async () => {
        const maker = await sign_in_with(["inventory.stock-adjustment.view", "inventory.stock-adjustment.create"]);
        const warehouses = await get(CONTEXTS.CONFIGURATION + SUB_CONTEXTS.WAREHOUSE + ROUTES.GET_WAREHOUSE_LIST_FOR_DROPDOWN, maker);
        const aisles = await get(CONTEXTS.CONFIGURATION + SUB_CONTEXTS.AISLE + ROUTES.GET_AISLE_LIST_FOR_DROPDOWN, maker);
        assert.deepEqual([warehouses.status, aisles.status], [200, 200]);
    });

    it("downloads one adjustment as a spreadsheet with the export permission only", async () => {
        const created = await post(CREATE, token, { reason: "opening_stock", lines: [OPENING_LINE()] });
        const res = await fetch(`${h.url()}${REPORT}/${created.body.data.oid}`, { headers: { authorization: `Bearer ${token}` } });
        assert.equal(res.status, 200);
        assert.match(decodeURIComponent(res.headers.get("x-filename")), /^ADJ-\d{4}-\d{4}\.xlsx$/);
        const viewer = await sign_in_with(["inventory.stock-adjustment.view"]);
        assert.equal((await fetch(`${h.url()}${REPORT}/${created.body.data.oid}`, { headers: { authorization: `Bearer ${viewer}` } })).status, 403);
    });
});
