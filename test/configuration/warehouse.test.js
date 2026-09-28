const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.WAREHOUSE;
const LIST = BASE + ROUTES.GET_WAREHOUSE_LIST;
const CREATE = BASE + ROUTES.CREATE_WAREHOUSE;
const UPDATE = BASE + ROUTES.UPDATE_WAREHOUSE_DETAILS;
const DETAILS = BASE + ROUTES.GET_WAREHOUSE_DETAILS;
const AVAILABILITY = BASE + ROUTES.CHECK_WAREHOUSE_AVAILABILITY;
const GENERATE = BASE + ROUTES.GENERATE_WAREHOUSE_CODE;
const DROPDOWN = BASE + ROUTES.GET_WAREHOUSE_LIST_FOR_DROPDOWN;
const REPORT = BASE + ROUTES.GENERATE_INVENTORY_REPORT_BY_WAREHOUSE;

const WRITER = ["configuration.warehouse.view", "configuration.warehouse.create", "configuration.warehouse.edit"];

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions, email = `owner-${uuidv4().slice(0, 8)}@arithmalabs.test`) => (await h.sign_in(await h.seed_user({ email, permissions }))).access;

const seed_warehouse = async (name, code, { capacity = null, status = "Active" } = {}) => {
    const oid = uuidv4();
    await h.query("INSERT INTO warehouse (oid, name, code, capacity_units, status) VALUES ($1, $2, $3, $4, $5)", [oid, name, code, capacity, status]);
    return oid;
};

const seed_aisle = async (warehouse, code) => {
    const oid = uuidv4();
    await h.query("INSERT INTO aisle (oid, name, code, warehouse_oid, status) VALUES ($1, $2, $2, $3, 'Active')", [oid, code, warehouse]);
    return oid;
};

// A product with a restock threshold, and a helper that receives a batch of it into a warehouse,
// optionally into an aisle, which is how stock comes to be somewhere.
const seed_product = async (threshold = 0) => {
    const [category, sub_category, product] = [uuidv4(), uuidv4(), uuidv4()];
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, $1, $1, 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, $1, $1, $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, status, restock_threshold) VALUES ($1, 'Cotton saree', $2, $3, 'Active', $4)", [product, category, sub_category, threshold]);
    return product;
};

let supplier;
const receive = async (product, warehouse, { aisle = null, quantity, cost }) => {
    if (!supplier) {
        supplier = uuidv4();
        await h.query("INSERT INTO supplier (oid, name, phone_number, status) VALUES ($1, 'Mill', '01700000000', 'Active')", [supplier]);
    }
    const [purchase, line, batch] = [uuidv4(), uuidv4(), uuidv4()];
    await h.query("INSERT INTO purchase (oid, supplier_oid, total_amount, paid_amount, status) VALUES ($1, $2, $3, 0, 'Verified')", [purchase, supplier, quantity * cost]);
    await h.query("INSERT INTO purchase_details (oid, purchase_oid, product_oid, warehouse_oid, aisle_oid, ordered_quantity, verified_quantity, ordered_unit_price) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)", [line, purchase, product, warehouse, aisle, quantity, cost]);
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, purchase_details_oid, initial_quantity, quantity_available, cost_price, status) VALUES ($1, $1, $2, $3, $4, $4, $5, 'ready_for_sale')", [batch, product, line, quantity, cost]);
    return batch;
};

describe("creating and editing a warehouse", () => {
    let author;

    beforeEach(async () => {
        await h.reset();
        author = await sign_in_with(WRITER);
    });

    it("creates a warehouse with its code in capitals and capacity as a number", async () => {
        const res = await post(CREATE, author, { name: "Back storeroom", code: "back", location: "Mohammadpur", capacity_units: 5000, status: "Active" });

        assert.equal(res.status, 200);
        const [row] = await h.query("SELECT code, capacity_units FROM warehouse WHERE oid = $1", [res.body.data.oid]);
        assert.deepEqual(row, { code: "BACK", capacity_units: 5000 });
    });

    it("refuses a capacity that is not a whole number of units", async () => {
        const res = await post(CREATE, author, { name: "Back", code: "BACK", capacity_units: "85,000 units", status: "Active" });
        assert.equal(res.status, 400);
    });

    it("refuses a name or a code another warehouse holds, whatever its case", async () => {
        await seed_warehouse("Main", "MAIN");

        const name = await post(CREATE, author, { name: " main ", code: "OTHER", status: "Active" });
        const code = await post(CREATE, author, { name: "Other", code: "main", status: "Active" });

        assert.equal(name.status, 409);
        assert.equal(name.body.data.field, "name");
        assert.equal(code.status, 409);
        assert.equal(code.body.data.field, "code");
    });

    it("writes nothing and logs nothing when saved unchanged", async () => {
        const body = { name: "Main", code: "MAIN", location: "Mohammadpur", capacity_units: 100, status: "Active" };
        const oid = (await post(CREATE, author, body)).body.data.oid;

        const res = await post(UPDATE, author, { oid, ...body });

        assert.equal(res.body.data.changed, false);
        const logs = await h.query("SELECT title FROM activity_log WHERE reference_oid = $1", [oid]);
        assert.deepEqual(logs.map((r) => r.title), ["Created warehouse"]);
    });

    it("suggests a code no other warehouse holds", async () => {
        await seed_warehouse("Storeroom", "STOR");
        const res = await get(GENERATE, author, { name: "Storeroom" });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.code, "STORE");
    });

    it("refuses someone holding view alone", async () => {
        const viewer = await sign_in_with(["configuration.warehouse.view"], `counter-${uuidv4().slice(0, 8)}@arithmalabs.test`);
        assert.equal((await post(CREATE, viewer, { name: "Any", code: "ANY", status: "Active" })).status, 403);
    });
});

describe("what a warehouse record tells the owner", () => {
    let viewer;
    let main;

    beforeEach(async () => {
        await h.reset();
        supplier = null;
        viewer = await sign_in_with(["configuration.warehouse.view"]);
        main = await seed_warehouse("Main", "MAIN", { capacity: 1000 });
    });

    const stats = async () => (await h.call(`${DETAILS}/${main}`, { method: "GET", token: viewer })).body.data.stats;

    it("counts what is here, what can be sold, and what it cost", async () => {
        const saree = await seed_product();
        const shelf = await seed_aisle(main, "SHELF");
        const batch = await receive(saree, main, { aisle: shelf, quantity: 10, cost: 500 });
        await receive(saree, await seed_warehouse("Other", "OTHER"), { quantity: 7, cost: 500 });
        const order = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, total_amount, status, channel) VALUES ($1, $1, 0, 'Confirmed', 'ONLINE')", [order]);
        await h.query("INSERT INTO stock_hold (oid, order_oid, inventory_oid, product_oid, quantity) VALUES ($1, $2, $3, $4, 4)", [uuidv4(), order, batch, saree]);

        const s = await stats();

        assert.equal(s.products, 1);
        assert.equal(s.onHand, 10);
        assert.equal(s.sellable, 6);
        assert.equal(s.value, 5000);
        assert.equal(s.fullRate, 1);
        assert.equal(s.zones, 1);
    });

    it("counts stock received into no aisle, which nobody can be sent to a shelf for", async () => {
        const saree = await seed_product();
        await receive(saree, main, { aisle: await seed_aisle(main, "SHELF"), quantity: 5, cost: 100 });
        await receive(saree, main, { quantity: 3, cost: 100 });

        assert.equal((await stats()).unplaced, 3);
    });

    it("counts a product as low when its stock across every location is at its threshold", async () => {
        const low = await seed_product(12);
        const fine = await seed_product(5);
        await receive(low, main, { quantity: 8, cost: 100 });
        await receive(low, await seed_warehouse("Other", "OTHER"), { quantity: 4, cost: 100 });
        await receive(fine, main, { quantity: 8, cost: 100 });

        assert.equal((await stats()).lowStock, 1);
    });

    it("says how full only when a capacity was given", async () => {
        const open = await seed_warehouse("Open", "OPEN");
        const res = await h.call(`${DETAILS}/${open}`, { method: "GET", token: viewer });
        assert.equal(res.body.data.stats.fullRate, null);
    });

    it("counts warehouses with stock and empty ones on the list", async () => {
        await receive(await seed_product(), main, { quantity: 2, cost: 100 });
        await seed_warehouse("Empty", "EMPTY");

        const res = await get(LIST, viewer, { include: "stats" });

        assert.deepEqual(res.body.data.stats, { active: 2, inactive: 0, stocked: 1, empty: 1 });
    });

    it("offers only Active warehouses in its picker, to the aisle form too", async () => {
        await seed_warehouse("Closed", "CLOSED", { status: "Inactive" });
        const aisleOnly = await sign_in_with(["configuration.aisle.view"], `aisle-${uuidv4().slice(0, 8)}@arithmalabs.test`);

        const res = await get(DROPDOWN, aisleOnly);

        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data.map((r) => r.label), ["Main"]);
    });

    it("keeps the reports from someone who may only view", async () => {
        assert.equal((await post(REPORT, viewer, { oid: main })).status, 403);
    });
});
