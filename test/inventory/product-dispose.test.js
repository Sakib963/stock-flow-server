const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { execute_transaction } = require("../../src/db/database");
const { holdStock } = require("../../src/routes/sales/utils/stock-movement");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.INVENTORY + SUB_CONTEXTS.PRODUCT_DISPOSE;
const LIST = BASE + ROUTES.GET_PRODUCT_DISPOSE_LIST;
const DETAILS = BASE + ROUTES.GET_PRODUCT_DISPOSE_DETAILS;
const PICKER = BASE + ROUTES.GET_PRODUCT_LIST_FOR_DISPOSE;
const CREATE = BASE + ROUTES.CREATE_PRODUCT_DISPOSE;
const UPDATE = BASE + ROUTES.UPDATE_PRODUCT_DISPOSE;
const APPROVE = BASE + ROUTES.APPROVE_PRODUCT_DISPOSE;
const REJECT = BASE + ROUTES.REJECT_PRODUCT_DISPOSE;
const CANCEL = BASE + ROUTES.CANCEL_PRODUCT_DISPOSE;
const REPORT = BASE + ROUTES.GENERATE_PRODUCT_DISPOSE_REPORT;
const ADJUST = CONTEXTS.INVENTORY + SUB_CONTEXTS.STOCK_ADJUSTMENT;

const ALL = ["view", "create", "edit", "approve", "reject", "cancel", "export"].map((action) => `inventory.product-dispose.${action}`);
const OWNER = [...ALL, "inventory.stock-value.view", "inventory.stock-adjustment.create", "inventory.stock-adjustment.approve"];
const USER = "owner@arithmalabs.test";

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `pd-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;

const movements = (batch) => h.query("SELECT quantity, balance_after, reason, source_oid FROM stock_movement WHERE inventory_oid = $1 ORDER BY created_on, oid", [batch]);
const on_hand = async (batch) => (await h.query("SELECT quantity_available::int AS q FROM inventory WHERE oid = $1", [batch]))[0].q;
const assert_balanced = async (batch) => {
    const rows = await movements(batch);
    const held = await on_hand(batch);
    assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), held);
    assert.equal(rows.at(-1).balance_after, held);
};

let ids;
let token;

const seed = async () => {
    await h.query("TRUNCATE dispose_details, product_dispose, stock_adjustment_line, stock_adjustment, stock_movement, cost_budget, inventory, stock_hold, order_items, orders, product_stats, product, sub_categories, categories, aisle, warehouse, activity_log CASCADE");
    const ids = { category: uuidv4(), sub_category: uuidv4(), cream: uuidv4(), main: uuidv4() };
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Skincare', 'SKIN', 'Active')", [ids.category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Creams', 'CREA', $2, 'Active')", [ids.sub_category, ids.category]);
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Sun cream', 'SUN', $2, $3, 5, 'Active')", [ids.cream, ids.category, ids.sub_category]);
    await h.query("INSERT INTO product_stats (oid, product_oid) VALUES ($1, $2)", [uuidv4(), ids.cream]);
    await h.query("INSERT INTO warehouse (oid, name, code, status) VALUES ($1, 'Main', 'MAIN', 'Active')", [ids.main]);
    return ids;
};

// 10 creams at cost 300, loaded as verified opening stock, so the batch has its ledger.
const batch_of_ten = async () => {
    const created = await post(ADJUST + ROUTES.CREATE_STOCK_ADJUSTMENT, token, { reason: "opening_stock", lines: [{ product_oid: ids.cream, quantity: 10, cost_price: 300, intended_use: "for_sale", selling_price: 500, maximum_discount: 50, warehouse_oid: ids.main }] });
    assert.equal((await post(ADJUST + ROUTES.VERIFY_STOCK_ADJUSTMENT, token, { oid: created.body.data.oid })).status, 200);
    return (await h.query("SELECT inventory_oid FROM stock_adjustment_line WHERE adjustment_oid = $1", [created.body.data.oid]))[0].inventory_oid;
};

const line = (batch, quantity, reason = "damaged", line_note = null) => ({ product_oid: ids.cream, inventory_oid: batch, quantity, reason, line_note });

beforeEach(async () => {
    await h.reset();
    ids = await seed();
    token = await sign_in_with(OWNER);
});

describe("disposing stock", () => {
    it("moves nothing as a draft or when submitted, and on approval takes the units out with a disposed movement at cost", async () => {
        const batch = await batch_of_ten();
        const draft = await post(CREATE, token, { draft: true, lines: [{ product_oid: ids.cream }] });
        assert.equal(draft.status, 200, JSON.stringify(draft.body));
        assert.equal(draft.body.data.status, "Draft");
        assert.match(draft.body.data.dispose_no, /^DSP-\d{4}-\d{4}$/);

        const saved = await post(UPDATE, token, { oid: draft.body.data.oid, method: "destroyed", lines: [line(batch, 2), line(batch, 1, "sample")] });
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.equal(saved.body.data.status, "Submitted");
        assert.equal(await on_hand(batch), 10);

        const record = (await get(`${DETAILS}/${draft.body.data.oid}`, token)).body.data;
        assert.deepEqual([record.details.units, Number(record.details.value), record.lines.map((l) => l.reason)], [3, 900, ["damaged", "sample"]]);

        assert.equal((await post(APPROVE, token, { oid: draft.body.data.oid })).status, 200);
        assert.equal(await on_hand(batch), 7);
        const moves = (await movements(batch)).filter((m) => m.reason === "disposed");
        assert.deepEqual(moves.map((m) => [m.quantity, m.source_oid]), [[-2, draft.body.data.oid], [-1, draft.body.data.oid]]);
        await assert_balanced(batch);
        const [stats] = await h.query("SELECT total_damaged::int AS damaged, total_wasted::int AS wasted FROM product_stats WHERE product_oid = $1", [ids.cream]);
        assert.deepEqual(stats, { damaged: 2, wasted: 1 });
    });

    it("takes only units free of holds, refusing at submit and again at approval when an order got there first", async () => {
        const batch = await batch_of_ten();
        const order = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, total_amount) VALUES ($1, 'INV-1', 0)", [order]);
        await execute_transaction((tx) => holdStock(tx, { order_oid: order, product_oid: ids.cream, inventory_oid: batch, quantity: 2, user_id: USER }));

        const too_many = await post(CREATE, token, { lines: [line(batch, 9)] });
        assert.equal(too_many.status, 400);
        assert.match(too_many.body.message, /^Line 1: batch .* has only 8 free/);

        const ok = await post(CREATE, token, { lines: [line(batch, 8)] });
        assert.equal(ok.status, 200);
        await execute_transaction((tx) => holdStock(tx, { order_oid: order, product_oid: ids.cream, inventory_oid: batch, quantity: 1, user_id: USER }));
        const refused = await post(APPROVE, token, { oid: ok.body.data.oid });
        assert.equal(refused.status, 409);
        assert.match(refused.body.message, /^Line 1: batch .* has only 7 free now/);
        assert.equal(await on_hand(batch), 10);
        const [{ status }] = await h.query("SELECT status FROM product_dispose WHERE oid = $1", [ok.body.data.oid]);
        assert.equal(status, "Submitted", "the whole approval rolled back");
        await assert_balanced(batch);
    });

    it("moves stock once when two people approve at the same moment", async () => {
        const batch = await batch_of_ten();
        const created = await post(CREATE, token, { lines: [line(batch, 1)] });
        const other = await sign_in_with(OWNER);
        const results = await Promise.all([post(APPROVE, token, { oid: created.body.data.oid }), post(APPROVE, other, { oid: created.body.data.oid })]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        assert.equal(await on_hand(batch), 9);
        await assert_balanced(batch);
    });

    it("counts damage even for a product that had no figures row yet", async () => {
        const batch = await batch_of_ten();
        await h.query("DELETE FROM product_stats WHERE product_oid = $1", [ids.cream]);
        const created = await post(CREATE, token, { lines: [line(batch, 3)] });
        assert.equal((await post(APPROVE, token, { oid: created.body.data.oid })).status, 200);
        const [stats] = await h.query("SELECT total_damaged::int AS damaged FROM product_stats WHERE product_oid = $1", [ids.cream]);
        assert.equal(stats.damaged, 3);
    });

    it("needs a line note when the reason is Other", async () => {
        const batch = await batch_of_ten();
        const bare = await post(CREATE, token, { lines: [line(batch, 1, "other")] });
        assert.equal(bare.status, 400);
        assert.match(bare.body.message, /^Line 1: say why/);
        assert.equal((await post(CREATE, token, { lines: [line(batch, 1, "other", "Left in the sun at the stall")] })).status, 200);
    });
});

describe("rejecting, cancelling and editing", () => {
    it("rejects with a reason and moves nothing; a rejected disposal can be neither approved nor edited", async () => {
        const batch = await batch_of_ten();
        const created = await post(CREATE, token, { lines: [line(batch, 2)] });
        assert.equal((await post(REJECT, token, { oid: created.body.data.oid, reason: "Counted again, it is fine" })).status, 200);
        assert.equal((await post(APPROVE, token, { oid: created.body.data.oid })).status, 409);
        assert.equal((await post(UPDATE, token, { oid: created.body.data.oid, lines: [line(batch, 1)] })).status, 409);
        assert.equal(await on_hand(batch), 10);
    });

    it("cancels a draft, never sends a submitted one back to draft, refuses to reject a draft, and counts one approval only", async () => {
        const batch = await batch_of_ten();
        const draft = await post(CREATE, token, { draft: true, lines: [] });
        assert.equal((await post(REJECT, token, { oid: draft.body.data.oid, reason: "Not needed" })).status, 409);
        assert.equal((await post(CANCEL, token, { oid: draft.body.data.oid, reason: "Made by mistake" })).status, 200);
        const submitted = await post(CREATE, token, { lines: [line(batch, 1)] });
        assert.equal((await post(UPDATE, token, { oid: submitted.body.data.oid, draft: true, lines: [line(batch, 1)] })).status, 409);
        const [cancel, approve] = await Promise.all([post(CANCEL, token, { oid: submitted.body.data.oid, reason: "Changed my mind" }), post(APPROVE, token, { oid: submitted.body.data.oid })]);
        assert.equal([cancel.status, approve.status].filter((s) => s === 200).length, 1, "cancel and approve cannot both win");
        await assert_balanced(batch);
    });

    it("never touches a disposal a customer return made, which arrives approved", async () => {
        const oid = uuidv4();
        await h.query("INSERT INTO product_dispose (oid, dispose_no, disposal_date, disposal_method, status, approved_by, approved_on) VALUES ($1, 'DISP-RET-1', CURRENT_DATE, 'destroyed', 'Approved', $2, now())", [oid, USER]);
        assert.equal((await post(UPDATE, token, { oid, draft: true, lines: [] })).status, 409);
        assert.equal((await post(CANCEL, token, { oid, reason: "Try to undo" })).status, 409);
        assert.equal((await post(REJECT, token, { oid, reason: "Try to undo" })).status, 409);
    });
});

describe("who may do what", () => {
    it("refuses each action without its permission, anything without a sign in, and hides cost from someone who may not see money", async () => {
        const batch = await batch_of_ten();
        const created = await post(CREATE, token, { lines: [line(batch, 1)] });
        const viewer = await sign_in_with(["inventory.product-dispose.view"]);
        assert.equal((await post(APPROVE, viewer, { oid: created.body.data.oid })).status, 403);
        assert.equal((await post(CREATE, viewer, { lines: [line(batch, 1)] })).status, 403);
        assert.equal((await get(PICKER, viewer)).status, 403);
        assert.equal((await get(LIST, null)).status, 401);

        const list = (await get(LIST, viewer, { include: "stats" })).body.data;
        assert.equal("value" in list.rows[0], false);
        assert.equal("value_this_month" in list.stats, false);
        const record = (await get(`${DETAILS}/${created.body.data.oid}`, viewer)).body.data;
        assert.deepEqual(["cost_price" in record.lines[0], "value" in record.details, record.sees_money], [false, false, false]);
    });

    it("gives the disposal report only with the export permission, with times in the business's clock", async () => {
        const batch = await batch_of_ten();
        const created = await post(CREATE, token, { lines: [line(batch, 2)] });
        const res = await fetch(`${h.url()}${REPORT}/${created.body.data.oid}`, { headers: { authorization: `Bearer ${token}` } });
        assert.equal(res.status, 200);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
        const cells = [];
        workbook.getWorksheet("Disposal").eachRow((row) => cells.push(...Array.from(row.values.slice(1), (value) => String(value ?? ""))));
        assert.ok(cells.includes("Damaged"));
        assert.ok(cells.some((cell) => cell.startsWith("Times in ")));
        const viewer = await sign_in_with(["inventory.product-dispose.view"]);
        assert.equal((await fetch(`${h.url()}${REPORT}/${created.body.data.oid}`, { headers: { authorization: `Bearer ${viewer}` } })).status, 403);
    });
});
