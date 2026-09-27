const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.AISLE;
const LIST = BASE + ROUTES.GET_AISLE_LIST;
const CREATE = BASE + ROUTES.CREATE_AISLE;
const UPDATE = BASE + ROUTES.UPDATE_AISLE_DETAILS;
const DETAILS = BASE + ROUTES.GET_AISLE_DETAILS;
const AVAILABILITY = BASE + ROUTES.CHECK_AISLE_AVAILABILITY;
const DROPDOWN = BASE + ROUTES.GET_AISLE_LIST_FOR_DROPDOWN;
const REPORT = BASE + ROUTES.GENERATE_INVENTORY_REPORT_BY_AISLE;

const WRITER = ["configuration.aisle.view", "configuration.aisle.create", "configuration.aisle.edit"];

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions, email = `owner-${uuidv4().slice(0, 8)}@samiha.test`) => (await h.sign_in(await h.seed_user({ email, permissions }))).access;

const seed_warehouse = async (name, status = "Active") => {
    const oid = uuidv4();
    await h.query("INSERT INTO warehouse (oid, name, code, status) VALUES ($1, $2, $2, $3)", [oid, name, status]);
    return oid;
};

const seed_aisle = async (warehouse, name, code, { capacity = null, status = "Active" } = {}) => {
    const oid = uuidv4();
    await h.query("INSERT INTO aisle (oid, name, code, warehouse_oid, capacity_units, status) VALUES ($1, $2, $3, $4, $5, $6)", [oid, name, code, warehouse, capacity, status]);
    return oid;
};

const seed_product = async (name, threshold = 0) => {
    const [category, sub_category, product] = [uuidv4(), uuidv4(), uuidv4()];
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, $1, $1, 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, $1, $1, $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, status, restock_threshold) VALUES ($1, $2, $3, $4, 'Active', $5)", [product, name, category, sub_category, threshold]);
    return product;
};

let supplier;
const receive = async (product, warehouse, aisle, quantity, cost = 100) => {
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

describe("creating and editing an aisle", () => {
    let author;
    let main;
    let back;

    beforeEach(async () => {
        await h.reset();
        supplier = null;
        author = await sign_in_with(WRITER);
        main = await seed_warehouse("MAIN");
        back = await seed_warehouse("BACK");
    });

    it("creates an aisle in a warehouse with an everyday storage type and capacity as a number", async () => {
        const res = await post(CREATE, author, { name: "Shelf A", code: "shlf", warehouse_oid: main, storage_type: "shelf", capacity_units: 200, status: "Active" });

        assert.equal(res.status, 200);
        const [row] = await h.query("SELECT code, storage_type, capacity_units FROM aisle WHERE oid = $1", [res.body.data.oid]);
        assert.deepEqual(row, { code: "SHLF", storage_type: "shelf", capacity_units: 200 });
    });

    it("refuses a storage type outside the list", async () => {
        const res = await post(CREATE, author, { name: "Bay", code: "BAY", warehouse_oid: main, storage_type: "drive_in_rack", status: "Active" });
        assert.equal(res.status, 400);
    });

    it("allows the same name in another warehouse, but never the same code", async () => {
        await seed_aisle(main, "Shelf A", "SHA");

        const sameName = await post(CREATE, author, { name: "Shelf A", code: "SHB", warehouse_oid: back, status: "Active" });
        const sameNameHere = await post(CREATE, author, { name: " shelf a ", code: "SHC", warehouse_oid: main, status: "Active" });
        const sameCode = await post(CREATE, author, { name: "Other", code: "sha", warehouse_oid: back, status: "Active" });

        assert.equal(sameName.status, 200);
        assert.equal(sameNameHere.status, 409);
        assert.equal(sameNameHere.body.data.field, "name");
        assert.equal(sameCode.status, 409);
        assert.equal(sameCode.body.data.field, "code");
    });

    it("refuses an Inactive or missing warehouse", async () => {
        const closed = await seed_warehouse("CLOSED", "Inactive");

        assert.equal((await post(CREATE, author, { name: "X", code: "X", warehouse_oid: closed, status: "Active" })).status, 400);
        assert.equal((await post(CREATE, author, { name: "X", code: "X", warehouse_oid: uuidv4(), status: "Active" })).status, 400);
    });

    it("moves an empty aisle to another warehouse, but not one stock was received into", async () => {
        const empty = await seed_aisle(main, "Empty", "EMP");
        const used = await seed_aisle(main, "Used", "USE");
        await receive(await seed_product("Saree"), main, used, 5);

        const moved = await post(UPDATE, author, { oid: empty, name: "Empty", code: "EMP", warehouse_oid: back, status: "Active" });
        const refused = await post(UPDATE, author, { oid: used, name: "Used", code: "USE", warehouse_oid: back, status: "Active" });

        assert.equal(moved.status, 200);
        assert.equal(refused.status, 400);
        assert.equal(refused.body.data.field, "warehouse_oid");
        assert.equal(refused.body.data.reason, "has_stock");
    });

    it("writes nothing and logs nothing when saved unchanged", async () => {
        const body = { name: "Shelf A", code: "SHA", warehouse_oid: main, storage_type: "shelf", capacity_units: 50, status: "Active" };
        const oid = (await post(CREATE, author, body)).body.data.oid;

        const res = await post(UPDATE, author, { oid, ...body });

        assert.equal(res.body.data.changed, false);
        const logs = await h.query("SELECT title FROM activity_log WHERE reference_oid = $1", [oid]);
        assert.deepEqual(logs.map((r) => r.title), ["Created aisle"]);
    });

    it("answers a name within its warehouse only, and a code everywhere", async () => {
        await seed_aisle(main, "Shelf A", "SHA");

        assert.equal((await get(AVAILABILITY, author, { field: "name", value: "SHELF A", warehouse_oid: main })).body.data.available, false);
        assert.equal((await get(AVAILABILITY, author, { field: "name", value: "Shelf A", warehouse_oid: back })).body.data.available, true);
        assert.equal((await get(AVAILABILITY, author, { field: "name", value: "Shelf A" })).status, 400);
        assert.equal((await get(AVAILABILITY, author, { field: "code", value: "sha" })).body.data.available, false);
    });

    it("refuses someone holding view alone", async () => {
        const viewer = await sign_in_with(["configuration.aisle.view"], `counter-${uuidv4().slice(0, 8)}@samiha.test`);
        assert.equal((await post(CREATE, viewer, { name: "X", code: "X", warehouse_oid: main, status: "Active" })).status, 403);
    });
});

describe("what an aisle record tells the storekeeper", () => {
    let viewer;
    let main;
    let shelf;

    beforeEach(async () => {
        await h.reset();
        supplier = null;
        viewer = await sign_in_with(["configuration.aisle.view"]);
        main = await seed_warehouse("MAIN");
        shelf = await seed_aisle(main, "Shelf A", "SHA", { capacity: 100 });
    });

    const record = async () => (await h.call(`${DETAILS}/${shelf}`, { method: "GET", token: viewer })).body.data;

    it("lists what is on the shelf by name, with units on hand and what can be sold", async () => {
        const saree = await seed_product("Saree");
        const kurti = await seed_product("Kurti");
        const batch = await receive(saree, main, shelf, 10, 500);
        await receive(kurti, main, shelf, 4, 300);
        await receive(saree, main, null, 7, 500);
        const order = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, total_amount, status, channel) VALUES ($1, $1, 0, 'Confirmed', 'ONLINE')", [order]);
        await h.query("INSERT INTO stock_hold (oid, order_oid, inventory_oid, product_oid, quantity) VALUES ($1, $2, $3, $4, 3)", [uuidv4(), order, batch, saree]);

        const { stats, items } = await record();

        assert.deepEqual(items.map((i) => [i.name, i.onHand, i.sellable]), [["Kurti", 4, 4], ["Saree", 10, 7]]);
        assert.equal(stats.products, 2);
        assert.equal(stats.onHand, 14);
        assert.equal(stats.value, 10 * 500 + 4 * 300);
        assert.equal(stats.fullRate, 14);
    });

    it("marks a product low when its stock across every location is at its threshold", async () => {
        const saree = await seed_product("Saree", 12);
        await receive(saree, main, shelf, 8);
        await receive(saree, main, null, 4);

        const { stats, items } = await record();

        assert.equal(stats.lowStock, 1);
        assert.equal(items[0].low, true);
    });

    it("counts aisles holding stock and empty ones on the list, filtered by warehouse", async () => {
        await receive(await seed_product("Saree"), main, shelf, 2);
        await seed_aisle(main, "Empty", "EMP");
        await seed_aisle(await seed_warehouse("OTHER"), "Far", "FAR");

        const res = await get(LIST, viewer, { include: "stats", warehouse_oid: main });

        assert.equal(res.body.total, 2);
        assert.deepEqual(res.body.data.stats, { active: 2, inactive: 0, stocked: 1, empty: 1 });
        assert.ok(res.body.data.rows.every((r) => r.warehouse_name === "MAIN"));
    });

    it("offers only Active aisles in Active warehouses in its picker", async () => {
        await seed_aisle(main, "Closed", "CLO", { status: "Inactive" });
        await seed_aisle(await seed_warehouse("SHUT", "Inactive"), "Gone", "GON");

        const res = await get(DROPDOWN, viewer);

        assert.deepEqual(res.body.data.map((r) => r.label), ["Shelf A"]);
    });

    it("keeps the reports from someone who may only view", async () => {
        assert.equal((await post(REPORT, viewer, { oid: shelf })).status, 403);
    });
});
