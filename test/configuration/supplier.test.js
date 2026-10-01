const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.SUPPLIER;
const LIST = BASE + ROUTES.GET_SUPPLIER_LIST;
const CREATE = BASE + ROUTES.CREATE_SUPPLIER;
const UPDATE = BASE + ROUTES.UPDATE_SUPPLIER_DETAILS;
const DETAILS = BASE + ROUTES.GET_SUPPLIER_DETAILS;
const AVAILABILITY = BASE + ROUTES.CHECK_SUPPLIER_AVAILABILITY;
const REPORT = BASE + ROUTES.GENERATE_SUPPLIER_PERFORMANCE_REPORT;

const WRITER = ["configuration.supplier.view", "configuration.supplier.create", "configuration.supplier.edit"];

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions, email = `owner-${uuidv4().slice(0, 8)}@arithmalabs.test`) => (await h.sign_in(await h.seed_user({ email, permissions }))).access;

const seed_supplier = async (name, phone, status = "Active") => {
    const oid = uuidv4();
    await h.query("INSERT INTO supplier (oid, name, phone_number, status) VALUES ($1, $2, $3, $4)", [oid, name, phone, status]);
    return oid;
};

// One product, one warehouse, and a helper that records a purchase order with one line and the batch
// it produced, which is how stock reaches the shop.
const seed_catalogue = async () => {
    const [category, sub_category, product, warehouse] = [uuidv4(), uuidv4(), uuidv4(), uuidv4()];
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Sarees', 'SARE', $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, status) VALUES ($1, 'Cotton saree', $2, $3, 'Active')", [product, category, sub_category]);
    await h.query("INSERT INTO warehouse (oid, name, code, status) VALUES ($1, 'Main', 'MAIN', 'Active')", [warehouse]);
    return { product, warehouse };
};

const seed_purchase = async ({ supplier, product, warehouse }, { status = "Verified", payment = "unpaid", total, paid = 0, ordered, received, cost, days = 3, promised = null }) => {
    const [purchase, line, batch] = [uuidv4(), uuidv4(), uuidv4()];
    await h.query(
        `INSERT INTO purchase (oid, supplier_oid, total_amount, paid_amount, payment_status, status, created_on, verified_on, expected_delivery_date)
         VALUES ($1, $2, $3, $4, $5, $6, '2026-09-01', $7, $8)`,
        [purchase, supplier, total, paid, payment, status, status === "Verified" ? `2026-09-${String(1 + days).padStart(2, "0")}` : null, promised]
    );
    await h.query("INSERT INTO purchase_details (oid, purchase_oid, product_oid, warehouse_oid, ordered_quantity, verified_quantity, ordered_unit_price) VALUES ($1, $2, $3, $4, $5, $6, $7)", [line, purchase, product, warehouse, ordered, received, cost]);
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, purchase_details_oid, initial_quantity, quantity_available, cost_price, status) VALUES ($1, $1, $2, $3, $4, $4, $5, 'ready_for_sale')", [batch, product, line, received, cost]);
    await h.query("UPDATE inventory i SET warehouse_oid = pd.warehouse_oid, aisle_oid = pd.aisle_oid FROM purchase_details pd WHERE pd.oid = i.purchase_details_oid AND i.oid = $1", [batch]);
    return batch;
};

const seed_sale = async (product, batch, { status, quantity, price, discount = 0, returned = 0 }) => {
    const order = uuidv4();
    await h.query("INSERT INTO orders (oid, invoice_no, total_amount, status, channel) VALUES ($1, $1, $2, $3, 'POS')", [order, (price - discount) * quantity, status]);
    await h.query("INSERT INTO order_items (oid, order_oid, inventory_oid, product_oid, product_name, quantity, unit_price, discount, total, returned_qty) VALUES ($1, $2, $3, $4, 'Cotton saree', $5, $6, $7, $8, $9)", [uuidv4(), order, batch, product, quantity, price, discount, (price - discount) * quantity, returned]);
};

const seed_disposal = async (product, batch, { reason, quantity, status = "Approved" }) => {
    const dispose = uuidv4();
    await h.query("INSERT INTO product_dispose (oid, dispose_no, disposal_date, status) VALUES ($1, $1, '2026-09-10', $2)", [dispose, status]);
    await h.query("INSERT INTO dispose_details (oid, dispose_oid, product_oid, inventory_oid, dispose_quantity, reason) VALUES ($1, $2, $3, $4, $5, $6)", [uuidv4(), dispose, product, batch, quantity, reason]);
};

describe("creating and editing a supplier", () => {
    let author;

    beforeEach(async () => {
        await h.reset();
        author = await sign_in_with(WRITER);
    });

    it("creates a supplier with only a name and a phone, since email is optional", async () => {
        const res = await post(CREATE, author, { name: "Islampur Fabrics", phone_number: "01712-345678", email: "", status: "Active" });

        assert.equal(res.status, 200);
        const [row] = await h.query("SELECT email, whatsapp_number FROM supplier WHERE oid = $1", [res.body.data.oid]);
        assert.deepEqual(row, { email: null, whatsapp_number: null });
    });

    it("refuses an email that is not an address", async () => {
        const res = await post(CREATE, author, { name: "Global", phone_number: "01987653412", email: "global@ditributor@gmail.com", status: "Active" });
        assert.equal(res.status, 400);
    });

    it("refuses a phone another supplier holds, however it is written", async () => {
        await seed_supplier("Dhaka Saree House", "01911223344");

        const res = await post(CREATE, author, { name: "Another", phone_number: "01911-223344", status: "Active" });

        assert.equal(res.status, 409);
        assert.equal(res.body.data.field, "phone_number");
    });

    it("refuses a second supplier of the same name, whatever its case", async () => {
        await seed_supplier("Dhaka Saree House", "01911223344");

        const res = await post(CREATE, author, { name: " dhaka saree house ", phone_number: "01700000000", status: "Active" });

        assert.equal(res.status, 409);
        assert.equal(res.body.data.field, "name");
    });

    it("keeps WhatsApp and payment details, and writes nothing when saved unchanged", async () => {
        const body = { name: "Rajshahi Silk", phone_number: "01711882299", whatsapp_number: "01811882299", payment_details: "bKash 01711882299", status: "Active" };
        const oid = (await post(CREATE, author, body)).body.data.oid;

        const res = await post(UPDATE, author, { oid, ...body });

        assert.equal(res.body.data.changed, false);
        const logs = await h.query("SELECT title FROM activity_log WHERE reference_oid = $1", [oid]);
        assert.deepEqual(logs.map((r) => r.title), ["Created supplier"]);
    });

    it("refuses someone holding view alone", async () => {
        const viewer = await sign_in_with(["configuration.supplier.view"], `counter-${uuidv4().slice(0, 8)}@arithmalabs.test`);
        const res = await post(CREATE, viewer, { name: "Any", phone_number: "01700000000", status: "Active" });
        assert.equal(res.status, 403);
    });
});

describe("asking whether a supplier name or phone is free", () => {
    it("compares a phone on its digits and leaves the supplier's own out", async () => {
        await h.reset();
        const author = await sign_in_with(WRITER);
        const oid = await seed_supplier("Dhaka Saree House", "01911223344");

        assert.equal((await get(AVAILABILITY, author, { field: "phone_number", value: "01911 223 344" })).body.data.available, false);
        assert.equal((await get(AVAILABILITY, author, { field: "phone_number", value: "01911223344", oid })).body.data.available, true);
        assert.equal((await get(AVAILABILITY, author, { field: "name", value: "DHAKA SAREE HOUSE" })).body.data.available, false);
    });
});

describe("what the supplier record tells the owner", () => {
    let viewer;
    let supplier;
    let ctx;

    beforeEach(async () => {
        await h.reset();
        viewer = await sign_in_with(["configuration.supplier.view"]);
        supplier = await seed_supplier("Dhaka Saree House", "01911223344");
        const { product, warehouse } = await seed_catalogue();
        ctx = { supplier, product, warehouse };
    });

    const stats = async () => (await h.call(`${DETAILS}/${supplier}`, { method: "GET", token: viewer })).body.data.stats;

    it("owes what received orders cost less what was paid, trusting the payment status over the paid amount", async () => {
        await seed_purchase(ctx, { payment: "paid", total: 10000, paid: 9000, ordered: 10, received: 10, cost: 1000 });
        await seed_purchase(ctx, { payment: "partially_paid", total: 6000, paid: 2000, ordered: 6, received: 6, cost: 1000 });
        await seed_purchase(ctx, { status: "Cancelled", payment: "paid", total: 5000, paid: 5000, ordered: 5, received: 0, cost: 1000 });
        await seed_purchase(ctx, { status: "Submitted", total: 3000, ordered: 3, received: 0, cost: 1000 });

        const s = await stats();

        assert.equal(s.spent, 16000);
        assert.equal(s.paid, 12000);
        assert.equal(s.owed, 4000);
        assert.equal(s.orders, 2);
        assert.equal(s.openOrders, 1);
    });

    it("keeps owed on the recorded order total, and reports what actually arrived beside it", async () => {
        await seed_purchase(ctx, { total: 1000, ordered: 10, received: 6, cost: 100 });

        const s = await stats();

        assert.equal(s.owed, 1000);
        assert.equal(s.receivedValue, 600);
    });

    it("counts what arrived short, and charges the supplier only for quality rejects", async () => {
        const batch = await seed_purchase(ctx, { total: 20000, ordered: 20, received: 18, cost: 1000 });
        await seed_disposal(ctx.product, batch, { reason: "quality_reject", quantity: 2 });
        await seed_disposal(ctx.product, batch, { reason: "damaged", quantity: 3 });
        await seed_disposal(ctx.product, batch, { reason: "quality_reject", quantity: 4, status: "Rejected" });

        const s = await stats();

        assert.equal(s.shortRate, 10);
        assert.equal(s.faultyUnits, 2);
        assert.equal(s.faultyRate, 11.1);
    });

    it("counts what sold from its batches: realized sales only, less returns, at the discounted price", async () => {
        const batch = await seed_purchase(ctx, { total: 10000, ordered: 10, received: 10, cost: 1000 });
        await seed_sale(ctx.product, batch, { status: "Purchased", quantity: 3, price: 1500, discount: 100 });
        await seed_sale(ctx.product, batch, { status: "PartiallyReturned", quantity: 2, price: 1500, returned: 1 });
        await seed_sale(ctx.product, batch, { status: "Pending", quantity: 4, price: 1500 });

        const s = await stats();

        assert.equal(s.unitsSold, 4);
        assert.equal(s.sales, 3 * 1400 + 1500);
        assert.equal(s.profit, 3 * 1400 + 1500 - 4 * 1000);
        assert.equal(s.sellThrough, 40);
    });

    it("rates delivery on time only against orders that carry a promised date", async () => {
        await seed_purchase(ctx, { total: 1000, ordered: 1, received: 1, cost: 1000, days: 3, promised: "2026-09-05" });
        await seed_purchase(ctx, { total: 1000, ordered: 1, received: 1, cost: 1000, days: 9, promised: "2026-09-05" });
        await seed_purchase(ctx, { total: 1000, ordered: 1, received: 1, cost: 1000, days: 6 });

        const s = await stats();

        assert.equal(s.promisedOrders, 2);
        assert.equal(s.onTimeRate, 50);
        assert.equal(s.leadDays, 6);
    });

    it("says nothing rather than 0% when there is nothing to rate", async () => {
        const s = await stats();
        assert.equal(s.onTimeRate, null);
        assert.equal(s.shortRate, null);
    });

    it("keeps the reports from someone who may only view", async () => {
        assert.equal((await post(REPORT, viewer, { oid: supplier })).status, 403);
    });

    it("counts suppliers still owed on the list", async () => {
        await seed_purchase(ctx, { total: 1000, ordered: 1, received: 1, cost: 1000 });
        await seed_supplier("Unused", "01800000000");

        const res = await get(LIST, viewer, { include: "stats" });

        assert.deepEqual(res.body.data.stats, { active: 2, inactive: 0, owing: 1, unused: 1 });
    });
});
