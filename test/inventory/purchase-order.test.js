const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.INVENTORY + SUB_CONTEXTS.PURCHASE_ORDER;
const LIST = BASE + ROUTES.GET_PURCHASE_LIST;
const DETAILS = BASE + ROUTES.GET_PURCHASE_DETAILS;
const PICKER = BASE + ROUTES.GET_PRODUCT_LIST_FOR_PURCHASE;
const CREATE = BASE + ROUTES.CREATE_PURCHASE;
const UPDATE = BASE + ROUTES.UPDATE_PURCHASE_DETAILS;
const PAYMENT = BASE + ROUTES.UPDATE_PURCHASE_PAYMENT;
const VERIFY = BASE + ROUTES.VERIFY_PURCHASE;
const CANCEL = BASE + ROUTES.CANCEL_PURCHASE;
const REPORT = BASE + ROUTES.GET_PURCHASE_ORDER_REPORT;
const SUPPLIERS = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.SUPPLIER + ROUTES.GET_SUPPLIER_LIST_FOR_DROPDOWN;
const WAREHOUSES = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.WAREHOUSE + ROUTES.GET_WAREHOUSE_LIST_FOR_DROPDOWN;
const AISLES = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.AISLE + ROUTES.GET_AISLE_LIST_FOR_DROPDOWN;

const ALL = ["view", "create", "edit", "approve", "cancel"].map((action) => `inventory.purchase-order.${action}`);

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `po-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;

// Two products, two warehouses with one aisle each, one supplier: enough to put a line in the wrong aisle.
const seed = async () => {
      await h.query("TRUNCATE purchase, purchase_details, purchase_details_cost_profile, inventory, stock_hold, order_items, orders, product, sub_categories, categories, aisle, warehouse, supplier CASCADE");
      const ids = { category: uuidv4(), sub_category: uuidv4(), kurti: uuidv4(), scarf: uuidv4(), main: uuidv4(), annex: uuidv4(), shelf: uuidv4(), rack: uuidv4(), supplier: uuidv4(), idle_supplier: uuidv4() };
      await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [ids.category]);
      await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Tops', 'TOPS', $2, 'Active')", [ids.sub_category, ids.category]);
      await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Cotton kurti', 'KURTI', $3, $4, 20, 'Active'), ($2, 'Woolen scarf', 'SCARF', $3, $4, 10, 'Active')", [ids.kurti, ids.scarf, ids.category, ids.sub_category]);
      await h.query("INSERT INTO warehouse (oid, name, code, status) VALUES ($1, 'Main', 'MAIN', 'Active'), ($2, 'Annex', 'ANNX', 'Active')", [ids.main, ids.annex]);
      await h.query("INSERT INTO aisle (oid, name, code, warehouse_oid, status) VALUES ($1, 'Shelf A', 'SHA', $2, 'Active'), ($3, 'Rack B', 'RKB', $4, 'Active')", [ids.shelf, ids.main, ids.rack, ids.annex]);
      await h.query("INSERT INTO supplier (oid, name, phone_number, status) VALUES ($1, 'Garment house', '01711000000', 'Active'), ($2, 'Closed supplier', '01711000001', 'Inactive')", [ids.supplier, ids.idle_supplier]);
      return ids;
};

const order = (ids, overrides = {}) => ({
      supplier_oid: ids.supplier,
      purchase_type: "advance",
      payment_status: "unpaid",
      paid_amount: 0,
      products: [
            { product_oid: ids.kurti, warehouse_oid: ids.main, aisle_oid: ids.shelf, quantity: 80, unit_price: 450 },
            { product_oid: ids.scarf, warehouse_oid: ids.annex, aisle_oid: null, quantity: 40, unit_price: 620 },
      ],
      ...overrides,
});

// What the edit page sends: everything but payment, which only Record payment changes.
const edit_of = (ids, oid, overrides = {}) => {
      const { payment_status, paid_amount, ...rest } = order(ids, overrides);
      return { oid, ...rest };
};

const lines_of = async (oid) => h.query("SELECT oid, product_oid, ordered_quantity::int AS ordered_quantity, ordered_unit_price::int AS price FROM purchase_details WHERE purchase_oid = $1 ORDER BY ordered_unit_price", [oid]);

const all_arrived = (lines) => lines.map((line) => ({ oid: line.oid, received_quantity: line.ordered_quantity, unit_price: line.price, intended_use: "for_sale", selling_price: line.price * 2, maximum_discount: 50 }));

describe("raising a purchase order", () => {
      let ids;
      let owner;

      beforeEach(async () => {
            await h.reset();
            ids = await seed();
            owner = await sign_in_with(ALL);
      });

      it("works out the total from the lines and numbers the order", async () => {
            const res = await post(CREATE, owner, order(ids));

            assert.equal(res.status, 200, JSON.stringify(res.body));
            assert.match(res.body.data.po_number, /^PO-\d{4}-\d{4,}$/);
            const [row] = await h.query("SELECT total_amount::int AS total, paid_amount::int AS paid, status FROM purchase WHERE oid = $1", [res.body.data.oid]);
            assert.deepEqual(row, { total: 80 * 450 + 40 * 620, paid: 0, status: "Submitted" });
      });

      it("records a paid order as paid in full, whatever amount was typed", async () => {
            const res = await post(CREATE, owner, order(ids, { payment_status: "paid", paid_amount: 122 }));

            const [row] = await h.query("SELECT paid_amount::int AS paid FROM purchase WHERE oid = $1", [res.body.data.oid]);
            assert.equal(row.paid, 80 * 450 + 40 * 620);
      });

      it("refuses a partial payment of nothing or of the whole total", async () => {
            for (const paid_amount of [0, 80 * 450 + 40 * 620]) {
                  const res = await post(CREATE, owner, order(ids, { payment_status: "partially_paid", paid_amount }));
                  assert.equal(res.status, 400);
                  assert.equal(res.body.data.field, "paid_amount");
            }
      });

      it("refuses an aisle that is not in the line's warehouse", async () => {
            const res = await post(CREATE, owner, order(ids, { products: [{ product_oid: ids.kurti, warehouse_oid: ids.main, aisle_oid: ids.rack, quantity: 5, unit_price: 100 }] }));

            assert.equal(res.status, 400);
            assert.equal((await h.query("SELECT count(*)::int AS n FROM purchase"))[0].n, 0);
      });

      it("refuses an inactive supplier", async () => {
            const res = await post(CREATE, owner, order(ids, { supplier_oid: ids.idle_supplier }));
            assert.equal(res.status, 400);
      });

      it("refuses a negative or zero quantity", async () => {
            const res = await post(CREATE, owner, order(ids, { products: [{ product_oid: ids.kurti, warehouse_oid: ids.main, quantity: 0, unit_price: 100 }] }));
            assert.equal(res.status, 400);
      });

      it("refuses someone who can only view purchase orders", async () => {
            const viewer = await sign_in_with(["inventory.purchase-order.view"]);
            assert.equal((await post(CREATE, viewer, order(ids))).status, 403);
      });

      it("keeps a payment recorded while the edit page was open", async () => {
            const oid = (await post(CREATE, owner, order(ids))).body.data.oid;
            await post(PAYMENT, owner, { oid, payment_status: "paid" });

            const res = await post(UPDATE, owner, edit_of(ids, oid, { special_notes: "Call before unloading" }));

            assert.equal(res.status, 200, JSON.stringify(res.body));
            const [row] = await h.query("SELECT payment_status, paid_amount::int AS paid FROM purchase WHERE oid = $1", [oid]);
            assert.deepEqual(row, { payment_status: "paid", paid: 80 * 450 + 40 * 620 });
      });

      it("refuses a payment sent with an edit", async () => {
            const oid = (await post(CREATE, owner, order(ids))).body.data.oid;
            assert.equal((await post(UPDATE, owner, { ...edit_of(ids, oid), payment_status: "paid" })).status, 400);
      });

      it("replaces the lines on an edit, and writes nothing when saved unchanged", async () => {
            const oid = (await post(CREATE, owner, order(ids))).body.data.oid;

            const same = await post(UPDATE, owner, edit_of(ids, oid));
            assert.equal(same.body.data.changed, false);

            const fewer = await post(UPDATE, owner, edit_of(ids, oid, { products: [{ product_oid: ids.scarf, warehouse_oid: ids.main, aisle_oid: ids.shelf, quantity: 10, unit_price: 600 }] }));
            assert.equal(fewer.status, 200, JSON.stringify(fewer.body));
            assert.equal((await lines_of(oid)).length, 1);
            const [row] = await h.query("SELECT total_amount::int AS total FROM purchase WHERE oid = $1", [oid]);
            assert.equal(row.total, 6000);
      });
});

describe("verifying a delivery", () => {
      let ids;
      let owner;
      let oid;

      beforeEach(async () => {
            await h.reset();
            ids = await seed();
            owner = await sign_in_with(ALL);
            oid = (await post(CREATE, owner, order(ids))).body.data.oid;
      });

      it("creates one batch per product, each with its own code, at the final price", async () => {
            const lines = await lines_of(oid);
            const arrived = all_arrived(lines);
            arrived[1].unit_price = 650;

            const res = await post(VERIFY, owner, { oid, lines: arrived });

            assert.equal(res.status, 200, JSON.stringify(res.body));
            const batches = await h.query("SELECT batch_code, product_oid, quantity_available::int AS qty, cost_price::int AS cost, status FROM inventory ORDER BY cost_price");
            assert.equal(batches.length, 2);
            assert.notEqual(batches[0].batch_code, batches[1].batch_code);
            for (const batch of batches) assert.match(batch.batch_code, /^B-\d{6}-\d{4,}$/);
            assert.deepEqual(batches.map((b) => [b.qty, b.cost, b.status]), [[80, 450, "ready_for_sale"], [40, 650, "ready_for_sale"]]);
      });

      it("makes no batch for a line where nothing arrived, and keeps internal use stock off sale", async () => {
            const lines = await lines_of(oid);
            const arrived = all_arrived(lines);
            arrived[0].received_quantity = 0;
            arrived[1] = { oid: lines[1].oid, received_quantity: 40, unit_price: 620, intended_use: "internal_use", selling_price: 999, maximum_discount: 5 };

            await post(VERIFY, owner, { oid, lines: arrived });

            const batches = await h.query("SELECT status, selling_price FROM inventory");
            assert.deepEqual(batches, [{ status: "internal_use", selling_price: null }]);
      });

      it("refuses more than was ordered and moves nothing", async () => {
            const arrived = all_arrived(await lines_of(oid));
            arrived[0].received_quantity = 81;

            const res = await post(VERIFY, owner, { oid, lines: arrived });

            assert.equal(res.status, 400);
            assert.equal((await h.query("SELECT count(*)::int AS n FROM inventory"))[0].n, 0);
            assert.equal((await h.query("SELECT status FROM purchase WHERE oid = $1", [oid]))[0].status, "Submitted");
      });

      it("refuses a maximum discount above the selling price", async () => {
            const arrived = all_arrived(await lines_of(oid));
            arrived[0].maximum_discount = arrived[0].selling_price + 1;
            assert.equal((await post(VERIFY, owner, { oid, lines: arrived })).status, 400);
      });

      it("adds stock once when two people verify the same order at the same moment", async () => {
            const arrived = all_arrived(await lines_of(oid));

            const results = await Promise.all([post(VERIFY, owner, { oid, lines: arrived }), post(VERIFY, owner, { oid, lines: arrived })]);

            assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
            assert.equal((await h.query("SELECT count(*)::int AS n FROM inventory"))[0].n, 2);
      });

      it("no longer lets the order be edited or cancelled once verified", async () => {
            await post(VERIFY, owner, { oid, lines: all_arrived(await lines_of(oid)) });

            assert.equal((await post(UPDATE, owner, edit_of(ids, oid))).status, 409);
            assert.equal((await post(CANCEL, owner, { oid, reason: "Changed our mind" })).status, 409);
      });

      it("still takes a payment after the delivery is verified", async () => {
            await post(VERIFY, owner, { oid, lines: all_arrived(await lines_of(oid)) });

            const res = await post(PAYMENT, owner, { oid, payment_status: "partially_paid", paid_amount: 20000 });

            assert.equal(res.status, 200, JSON.stringify(res.body));
            const [row] = await h.query("SELECT payment_status, paid_amount::int AS paid FROM purchase WHERE oid = $1", [oid]);
            assert.deepEqual(row, { payment_status: "partially_paid", paid: 20000 });
      });

      it("refuses someone who may raise orders but not verify them", async () => {
            const clerk = await sign_in_with(["inventory.purchase-order.view", "inventory.purchase-order.create"]);
            assert.equal((await post(VERIFY, clerk, { oid, lines: all_arrived(await lines_of(oid)) })).status, 403);
      });
});

describe("drafting a purchase order", () => {
      let ids;
      let owner;

      beforeEach(async () => {
            await h.reset();
            ids = await seed();
            owner = await sign_in_with(ALL);
      });

      const half = (ids) => ({ draft: true, supplier_oid: ids.supplier, products: [{ product_oid: ids.kurti }, { product_oid: ids.scarf, warehouse_oid: ids.main, quantity: 5 }] });

      it("saves a draft with only the supplier and half typed lines", async () => {
            const res = await post(CREATE, owner, half(ids));

            assert.equal(res.status, 200, JSON.stringify(res.body));
            const [row] = await h.query("SELECT status, payment_status, total_amount::int AS total FROM purchase WHERE oid = $1", [res.body.data.oid]);
            assert.deepEqual(row, { status: "Draft", payment_status: null, total: 0 });
            assert.equal((await lines_of(res.body.data.oid)).length, 2);
      });

      it("keeps a draft out of stock and payment until it is submitted", async () => {
            const oid = (await post(CREATE, owner, half(ids))).body.data.oid;

            const nothing = (await lines_of(oid)).map((line) => ({ oid: line.oid, received_quantity: 0, unit_price: 0, intended_use: "internal_use" }));
            assert.equal((await post(VERIFY, owner, { oid, lines: nothing })).status, 409);
            assert.equal((await post(PAYMENT, owner, { oid, payment_status: "paid" })).status, 409);
            assert.equal((await h.query("SELECT count(*)::int AS n FROM inventory"))[0].n, 0);
      });

      it("refuses to submit a draft whose lines or payment are not complete", async () => {
            const oid = (await post(CREATE, owner, half(ids))).body.data.oid;

            const incomplete = await post(UPDATE, owner, { oid, supplier_oid: ids.supplier, purchase_type: "overseas", payment_status: "unpaid", products: [{ product_oid: ids.kurti }] });
            assert.equal(incomplete.status, 400);
            const no_payment = await post(UPDATE, owner, { ...edit_of(ids, oid), purchase_type: "overseas" });
            assert.equal(no_payment.status, 400);
            assert.equal((await h.query("SELECT status FROM purchase WHERE oid = $1", [oid]))[0].status, "Draft");
      });

      it("submits a draft once everything is filled in, and it can then be verified", async () => {
            const oid = (await post(CREATE, owner, half(ids))).body.data.oid;

            const res = await post(UPDATE, owner, { oid, ...order(ids, { payment_status: "partially_paid", paid_amount: 1000 }) });

            assert.equal(res.status, 200, JSON.stringify(res.body));
            assert.equal(res.body.data.status, "Submitted");
            const [row] = await h.query("SELECT status, paid_amount::int AS paid FROM purchase WHERE oid = $1", [oid]);
            assert.deepEqual(row, { status: "Submitted", paid: 1000 });
            assert.equal((await post(VERIFY, owner, { oid, lines: all_arrived(await lines_of(oid)) })).status, 200);
      });

      it("never turns a submitted order back into a draft", async () => {
            const oid = (await post(CREATE, owner, order(ids))).body.data.oid;
            assert.equal((await post(UPDATE, owner, { ...edit_of(ids, oid), draft: true })).status, 409);
      });

      it("lets a draft be cancelled", async () => {
            const oid = (await post(CREATE, owner, half(ids))).body.data.oid;
            assert.equal((await post(CANCEL, owner, { oid, reason: "Ordered from another supplier" })).status, 200);
      });
});

describe("cancelling a purchase order", () => {
      let ids;
      let owner;
      let oid;

      beforeEach(async () => {
            await h.reset();
            ids = await seed();
            owner = await sign_in_with(ALL);
            oid = (await post(CREATE, owner, order(ids, { payment_status: "partially_paid", paid_amount: 5000 }))).body.data.oid;
      });

      it("keeps the reason, and then refuses a verify or a payment change", async () => {
            const res = await post(CANCEL, owner, { oid, reason: "Supplier could not deliver before Eid" });

            assert.equal(res.status, 200);
            const [row] = await h.query("SELECT status, cancel_reason FROM purchase WHERE oid = $1", [oid]);
            assert.deepEqual(row, { status: "Cancelled", cancel_reason: "Supplier could not deliver before Eid" });
            assert.equal((await post(VERIFY, owner, { oid, lines: all_arrived(await lines_of(oid)) })).status, 409);
            assert.equal((await post(PAYMENT, owner, { oid, payment_status: "unpaid" })).status, 409);
      });

      it("refuses someone without the cancel permission", async () => {
            const editor = await sign_in_with(["inventory.purchase-order.view", "inventory.purchase-order.edit"]);
            assert.equal((await post(CANCEL, editor, { oid, reason: "No reason" })).status, 403);
      });
});

describe("reading purchase orders", () => {
      let ids;
      let owner;

      beforeEach(async () => {
            await h.reset();
            ids = await seed();
            owner = await sign_in_with(ALL);
      });

      it("lists orders with the paid figure following the payment status", async () => {
            const oid = (await post(CREATE, owner, order(ids))).body.data.oid;
            await h.query("UPDATE purchase SET payment_status = 'paid', paid_amount = 122 WHERE oid = $1", [oid]);

            const res = await get(LIST, owner, { include: "stats" });

            assert.equal(res.status, 200);
            assert.equal(res.body.data.rows[0].paid_amount, String(80 * 450 + 40 * 620));
            assert.equal(res.body.data.stats.submitted, 1);
      });

      it("shows each line with its batch once verified", async () => {
            const oid = (await post(CREATE, owner, order(ids))).body.data.oid;
            await post(VERIFY, owner, { oid, lines: all_arrived(await lines_of(oid)) });

            const res = await get(`${DETAILS}/${oid}`, owner);

            assert.equal(res.status, 200);
            assert.equal(res.body.data.stats.received_units, 120);
            assert.ok(res.body.data.lines.every((line) => line.batches.length === 1));
      });

      it("offers the last price paid and units sold in the last 30 days in the product search", async () => {
            const oid = (await post(CREATE, owner, order(ids))).body.data.oid;
            await post(VERIFY, owner, { oid, lines: all_arrived(await lines_of(oid)) });
            const [batch] = await h.query("SELECT oid FROM inventory WHERE product_oid = $1", [ids.kurti]);
            const [recent, old] = [uuidv4(), uuidv4()];
            await h.query("INSERT INTO orders (oid, invoice_no, total_amount, status, channel, sold_on) VALUES ($1, 'A1', 900, 'Purchased', 'POS', now() - interval '2 days'), ($2, 'A2', 900, 'Purchased', 'POS', now() - interval '40 days')", [recent, old]);
            await h.query("INSERT INTO order_items (oid, order_oid, inventory_oid, product_oid, product_name, quantity, unit_price, discount, total, returned_qty) VALUES ($1, $2, $3, $4, 'Cotton kurti', 3, 900, 0, 2700, 1), ($5, $6, $3, $4, 'Cotton kurti', 5, 900, 0, 4500, 0)", [uuidv4(), recent, batch.oid, ids.kurti, uuidv4(), old]);

            const res = await get(PICKER, owner, { search: "kurti" });

            assert.equal(res.status, 200);
            const [kurti] = res.body.data;
            assert.equal(kurti.sold_30_days, 2);
            assert.equal(Number(kurti.last_unit_price), 450);
            assert.equal(kurti.last_supplier_name, "Garment house");
      });
});

describe("what a purchase order reads from elsewhere", () => {
      beforeEach(async () => {
            await h.reset();
            await seed();
      });

      it("lets someone raising an order pick a supplier, warehouse and aisle without configuration access", async () => {
            const clerk = await sign_in_with(["inventory.purchase-order.view", "inventory.purchase-order.create"]);
            for (const route of [SUPPLIERS, WAREHOUSES, AISLES]) assert.equal((await get(route, clerk)).status, 200, route);
      });

      it("lets someone who only views orders filter the list by supplier", async () => {
            const viewer = await sign_in_with(["inventory.purchase-order.view"]);
            assert.equal((await get(SUPPLIERS, viewer)).status, 200);
      });

      it("refuses the reports to someone without the export permission", async () => {
            const viewer = await sign_in_with(["inventory.purchase-order.view"]);
            assert.equal((await post(REPORT, viewer, { oid: uuidv4() })).status, 403);
      });
});
