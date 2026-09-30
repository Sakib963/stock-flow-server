const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const PO = CONTEXTS.INVENTORY + SUB_CONTEXTS.PURCHASE_ORDER;
const CREATE = PO + ROUTES.CREATE_PURCHASE;
const PO_DETAILS = PO + ROUTES.GET_PURCHASE_DETAILS;
const VERIFY = PO + ROUTES.VERIFY_PURCHASE;
const EXPIRY = PO + ROUTES.UPDATE_BATCH_EXPIRY;
const PRODUCT = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.PRODUCT;
const CREATE_PRODUCT = PRODUCT + ROUTES.CREATE_PRODUCT;
const UPDATE_PRODUCT = PRODUCT + ROUTES.UPDATE_PRODUCT_DETAILS;
const PRODUCT_DETAILS = PRODUCT + ROUTES.GET_PRODUCT_DETAILS;

const RIGHTS = [...["view", "create", "edit", "approve"].map((action) => `inventory.purchase-order.${action}`), "configuration.product.view", "configuration.product.create", "configuration.product.edit"];

before(h.start);
after(h.stop);

const get = (route, token) => h.call(route, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `bx-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;

const seed = async () => {
    await h.query("TRUNCATE stock_movement, purchase, purchase_details, purchase_details_cost_profile, inventory, stock_hold, product, sub_categories, categories, aisle, warehouse, supplier, activity_log CASCADE");
    const ids = { category: uuidv4(), sub_category: uuidv4(), cream: uuidv4(), bag: uuidv4(), main: uuidv4(), supplier: uuidv4() };
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Skincare', 'SKIN', 'Active')", [ids.category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Creams', 'CREA', $2, 'Active')", [ids.sub_category, ids.category]);
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status, has_expiry) VALUES ($1, 'Sun cream', 'SUN', $2, $3, 5, 'Active', true)", [ids.cream, ids.category, ids.sub_category]);
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Tote bag', 'TOTE', $2, $3, 5, 'Active')", [ids.bag, ids.category, ids.sub_category]);
    await h.query("INSERT INTO warehouse (oid, name, code, status) VALUES ($1, 'Main', 'MAIN', 'Active')", [ids.main]);
    await h.query("INSERT INTO supplier (oid, name, phone_number, status) VALUES ($1, 'Beauty house', '01711000000', 'Active')", [ids.supplier]);
    return ids;
};

// One order for the cream and the bag, verified with whatever expiry each line is given.
const receive = async (ids, token, expiry = {}) => {
    const products = [ids.cream, ids.bag].map((product_oid) => ({ product_oid, warehouse_oid: ids.main, aisle_oid: null, quantity: 10, unit_price: 300 }));
    const created = await post(CREATE, token, { supplier_oid: ids.supplier, purchase_type: "advance", payment_status: "unpaid", paid_amount: 0, products });
    const oid = created.body.data.oid;
    const { lines } = (await get(`${PO_DETAILS}/${oid}`, token)).body.data;
    const verified = await post(VERIFY, token, {
        oid,
        lines: lines.map((line) => ({ oid: line.oid, received_quantity: 10, unit_price: 300, intended_use: "for_sale", selling_price: 500, maximum_discount: 0, expiry_date: expiry[line.product_oid] })),
    });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    const batches = await h.query("SELECT oid, product_oid, to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date FROM inventory");
    const batch = (product) => batches.find((b) => b.product_oid === product);
    return { purchase_oid: oid, cream: batch(ids.cream), bag: batch(ids.bag) };
};

describe("an expiry date at purchase order verify", () => {
    let ids;
    let token;

    beforeEach(async () => {
        await h.reset();
        ids = await seed();
        token = await sign_in_with(RIGHTS);
    });

    it("keeps the date given for a product that expires", async () => {
        const got = await receive(ids, token, { [ids.cream]: "2027-03-31" });
        assert.equal(got.cream.expiry_date, "2027-03-31");
    });

    it("verifies an expiring product without a date, since the date is optional", async () => {
        const got = await receive(ids, token);
        assert.equal(got.cream.expiry_date, null);
    });

    it("drops a date sent for a product that does not expire", async () => {
        const got = await receive(ids, token, { [ids.bag]: "2027-03-31" });
        assert.equal(got.bag.expiry_date, null);
    });

    it("refuses a date that is not a real calendar day", async () => {
        const created = await post(CREATE, token, { supplier_oid: ids.supplier, purchase_type: "advance", payment_status: "unpaid", paid_amount: 0, products: [{ product_oid: ids.cream, warehouse_oid: ids.main, aisle_oid: null, quantity: 1, unit_price: 300 }] });
        const [line] = (await get(`${PO_DETAILS}/${created.body.data.oid}`, token)).body.data.lines;
        const res = await post(VERIFY, token, { oid: created.body.data.oid, lines: [{ oid: line.oid, received_quantity: 1, unit_price: 300, intended_use: "for_sale", selling_price: 500, maximum_discount: 0, expiry_date: "2027-02-30" }] });
        assert.equal(res.status, 400);
    });

    it("shows the date on the verified order's batch and on the product page, as a plain day", async () => {
        const got = await receive(ids, token, { [ids.cream]: "2027-03-31" });
        const line = (await get(`${PO_DETAILS}/${got.purchase_oid}`, token)).body.data.lines.find((l) => l.product_oid === ids.cream);
        assert.equal(line.has_expiry, true);
        assert.equal(line.batches[0].expiry_date, "2027-03-31");

        const product = (await get(`${PRODUCT_DETAILS}/${ids.cream}`, token)).body.data;
        assert.equal(product.details.has_expiry, true);
        assert.equal(product.stock.batches[0].expiry_date, "2027-03-31");
    });
});

describe("changing a batch's expiry date after verify", () => {
    let ids;
    let token;
    let got;

    beforeEach(async () => {
        await h.reset();
        ids = await seed();
        token = await sign_in_with(RIGHTS);
        got = await receive(ids, token);
    });

    it("sets, changes and clears the date, logs each change, and never writes a stock movement", async () => {
        const movements = async () => (await h.query("SELECT count(*)::int AS n FROM stock_movement WHERE inventory_oid = $1", [got.cream.oid]))[0].n;
        const held = async () => (await h.query("SELECT quantity_available::int AS n FROM inventory WHERE oid = $1", [got.cream.oid]))[0].n;
        const before = await movements();
        const on_hand = await held();

        for (const date of ["2027-03-31", "2027-04-15", null]) {
            const res = await post(EXPIRY, token, { inventory_oid: got.cream.oid, expiry_date: date });
            assert.equal(res.status, 200, JSON.stringify(res.body));
            const [row] = await h.query("SELECT to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date FROM inventory WHERE oid = $1", [got.cream.oid]);
            assert.equal(row.expiry_date, date);
        }

        const logged = await h.query("SELECT description FROM activity_log WHERE reference_oid = $1 AND title = 'Expiry date changed' ORDER BY performed_on", [got.purchase_oid]);
        assert.equal(logged.length, 3);
        assert.match(logged[1].description, /2027-03-31 to 2027-04-15/);
        assert.equal(await movements(), before);
        assert.equal(await held(), on_hand);
    });

    it("writes nothing when the date is the same", async () => {
        await post(EXPIRY, token, { inventory_oid: got.cream.oid, expiry_date: "2027-03-31" });
        const again = await post(EXPIRY, token, { inventory_oid: got.cream.oid, expiry_date: "2027-03-31" });
        assert.equal(again.body.data.changed, false);
    });

    it("refuses a date on a batch of a product that does not expire, but lets an old date be cleared", async () => {
        const res = await post(EXPIRY, token, { inventory_oid: got.bag.oid, expiry_date: "2027-03-31" });
        assert.equal(res.status, 409);
        assert.equal(res.body.data.reason, "no_expiry");

        await h.query("UPDATE inventory SET expiry_date = '2027-01-01' WHERE oid = $1", [got.bag.oid]);
        assert.equal((await post(EXPIRY, token, { inventory_oid: got.bag.oid, expiry_date: null })).status, 200);
    });

    it("refuses someone who cannot edit purchase orders, and a batch that does not exist", async () => {
        const viewer = await sign_in_with(["inventory.purchase-order.view"]);
        assert.equal((await post(EXPIRY, viewer, { inventory_oid: got.cream.oid, expiry_date: "2027-03-31" })).status, 403);
        assert.equal((await post(EXPIRY, token, { inventory_oid: uuidv4(), expiry_date: "2027-03-31" })).status, 404);
    });
});

describe("the product's expiry switch", () => {
    it("is off unless turned on, and turning it on is saved and logged", async () => {
        await h.reset();
        const ids = await seed();
        const token = await sign_in_with(RIGHTS);
        const fields = { name: "Face serum", sub_category_oid: ids.sub_category, restock_threshold: 5, status: "Active" };

        const created = await post(CREATE_PRODUCT, token, fields);
        assert.equal(created.status, 200, JSON.stringify(created.body));
        const oid = created.body.data.oid;
        assert.equal((await get(`${PRODUCT_DETAILS}/${oid}`, token)).body.data.details.has_expiry, false);

        const updated = await post(UPDATE_PRODUCT, token, { oid, ...fields, has_expiry: true });
        assert.equal(updated.status, 200, JSON.stringify(updated.body));
        assert.equal((await get(`${PRODUCT_DETAILS}/${oid}`, token)).body.data.details.has_expiry, true);
        const [log] = await h.query("SELECT description FROM activity_log WHERE reference_oid = $1 AND title = 'Updated product'", [oid]);
        assert.match(log.description, /Has an expiry date.*"No".*"Yes"/);

        const again = await post(UPDATE_PRODUCT, token, { oid, ...fields, restock_threshold: 6 });
        assert.equal(again.status, 200, JSON.stringify(again.body));
        assert.equal((await get(`${PRODUCT_DETAILS}/${oid}`, token)).body.data.details.has_expiry, true, "an update that leaves the switch out keeps it");
    });
});
