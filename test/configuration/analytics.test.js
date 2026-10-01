const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const ANALYTICS = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.ANALYTICS + ROUTES.GET_CONFIGURATION_ANALYTICS;

const EVERYTHING = [
    "configuration.analytics.view",
    "configuration.product.view",
    "configuration.category.view",
    "configuration.sub-category.view",
    "configuration.brands.view",
    "configuration.supplier.view",
    "configuration.warehouse.view",
    "configuration.aisle.view",
];

before(h.start);
after(h.stop);

const sign_in_with = async (permissions) => (await h.sign_in(await h.seed_user({ email: `owner-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions }))).access;
const read = async (token) => h.call(ANALYTICS, { method: "GET", token });

const seed_category = async (name, status = "Active") => {
    const [category, sub_category] = [uuidv4(), uuidv4()];
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, $2, $1, $3)", [category, name, status]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, $2, $1, $3, 'Active')", [sub_category, `${name} sub`, category]);
    return { category, sub_category };
};

const seed_brand = async (name, status = "Active") => {
    const oid = uuidv4();
    await h.query("INSERT INTO brands (oid, name, status) VALUES ($1, $2, $3)", [oid, name, status]);
    return oid;
};

// Complete unless told otherwise: a photo, a brand and a restock threshold.
const seed_product = async (name, { category, sub_category }, { brand = null, photo = "https://res.cloudinary.com/x/kurti.jpg", threshold = 5, deleted = false } = {}) => {
    const oid = uuidv4();
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, brand_oid, photo, restock_threshold, status, is_deleted) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Active', $8)", [oid, name, category, sub_category, brand, photo, threshold, deleted]);
    return oid;
};

const seed_supplier = async (name) => {
    const oid = uuidv4();
    await h.query("INSERT INTO supplier (oid, name, phone_number, status) VALUES ($1, $2, $3, 'Active')", [oid, name, `017${Math.floor(Math.random() * 1e8)}`]);
    return oid;
};

const seed_warehouse = async (name, capacity = null) => {
    const oid = uuidv4();
    await h.query("INSERT INTO warehouse (oid, name, code, capacity_units, status) VALUES ($1, $2, $1, $3, 'Active')", [oid, name, capacity]);
    return oid;
};

const seed_aisle = async (warehouse, name) => {
    const oid = uuidv4();
    await h.query("INSERT INTO aisle (oid, name, code, warehouse_oid, status) VALUES ($1, $2, $1, $3, 'Active')", [oid, name, warehouse]);
    return oid;
};

const receive = async (supplier, product, { warehouse, aisle = null, quantity = 10, status = "Verified" }) => {
    const [purchase, line, batch] = [uuidv4(), uuidv4(), uuidv4()];
    await h.query("INSERT INTO purchase (oid, supplier_oid, total_amount, paid_amount, status) VALUES ($1, $2, 0, 0, $3)", [purchase, supplier, status]);
    await h.query("INSERT INTO purchase_details (oid, purchase_oid, product_oid, warehouse_oid, aisle_oid, ordered_quantity, verified_quantity, ordered_unit_price) VALUES ($1, $2, $3, $4, $5, GREATEST($6::int, 1), $6, 100)", [line, purchase, product, warehouse, aisle, quantity]);
    if (status === "Verified") {
        await h.query("INSERT INTO inventory (oid, batch_code, product_oid, purchase_details_oid, initial_quantity, quantity_available, cost_price, status) VALUES ($1, $1, $2, $3, $4, $4, 100, 'ready_for_sale')", [batch, product, line, quantity]);
        await h.query("UPDATE inventory i SET warehouse_oid = pd.warehouse_oid, aisle_oid = pd.aisle_oid FROM purchase_details pd WHERE pd.oid = i.purchase_details_oid AND i.oid = $1", [batch]);
    }
};

const check = (body, key) => body.data.attention.find((a) => a.key === key);
const names = (body, key) => check(body, key).items.map((i) => i.name);

describe("who can open configuration analytics", () => {
    beforeEach(h.reset);

    it("refuses someone without analytics", async () => {
        const token = await sign_in_with(["configuration.product.view"]);
        assert.equal((await read(token)).status, 403);
    });

    it("shows nothing about a feature the person cannot open", async () => {
        const place = await seed_category("Sarees");
        await seed_product("Cotton saree", place, { photo: null });

        const res = await read(await sign_in_with(["configuration.analytics.view", "configuration.category.view"]));

        assert.equal(res.status, 200);
        assert.deepEqual(Object.keys(res.body.data.counts), ["category"]);
        assert.deepEqual(res.body.data.attention.map((a) => a.key), ["emptyCategories", "inactiveCategoriesInUse"]);
        assert.deepEqual(Object.keys(res.body.data.spread), ["category"]);
        assert.equal(res.body.data.warehouses, null);
    });
});

describe("what needs attention in the catalogue", () => {
    let token;

    beforeEach(async () => {
        await h.reset();
        token = await sign_in_with(EVERYTHING);
    });

    it("names the products missing a photo, a brand or a restock threshold, and leaves out a deleted one", async () => {
        const place = await seed_category("Sarees");
        const brand = await seed_brand("Aarong");
        await seed_product("Complete saree", place, { brand });
        await seed_product("No photo saree", place, { brand, photo: "  " });
        await seed_product("No brand saree", place);
        await seed_product("No threshold saree", place, { brand, threshold: 0 });
        await seed_product("Deleted saree", place, { photo: null, threshold: 0, deleted: true });

        const { body } = await read(token);

        assert.deepEqual(names(body, "productsWithoutPhoto"), ["No photo saree"]);
        assert.deepEqual(names(body, "productsWithoutBrand"), ["No brand saree"]);
        assert.deepEqual(names(body, "productsWithoutThreshold"), ["No threshold saree"]);
    });

    it("counts every record but names only the first five", async () => {
        const place = await seed_category("Sarees");
        for (const n of [1, 2, 3, 4, 5, 6, 7]) await seed_product(`Saree ${n}`, place, { photo: null, brand: await seed_brand(`Brand ${n}`) });

        const photo = check((await read(token)).body, "productsWithoutPhoto");

        assert.equal(photo.total, 7);
        assert.deepEqual(photo.items.map((i) => i.name), ["Saree 1", "Saree 2", "Saree 3", "Saree 4", "Saree 5"]);
    });

    it("finds the categories, sub-categories and brands nothing is filed under", async () => {
        const used = await seed_category("Sarees");
        await seed_category("Shoes");
        await seed_brand("Unused brand");
        await seed_product("Cotton saree", used, { brand: await seed_brand("Aarong") });

        const { body } = await read(token);

        assert.deepEqual(names(body, "emptyCategories"), ["Shoes"]);
        assert.deepEqual(names(body, "emptySubCategories"), ["Shoes sub"]);
        assert.deepEqual(check(body, "emptySubCategories").items[0].detail, "Shoes");
        assert.deepEqual(names(body, "emptyBrands"), ["Unused brand"]);
    });

    it("finds an inactive category or brand that active products are still sold under", async () => {
        const hidden = await seed_category("Old sarees", "Inactive");
        const brand = await seed_brand("Old brand", "Inactive");
        await seed_category("Idle", "Inactive");
        await seed_product("Cotton saree", hidden, { brand });

        const { body } = await read(token);

        assert.deepEqual(names(body, "inactiveCategoriesInUse"), ["Old sarees"]);
        assert.deepEqual(names(body, "inactiveBrandsInUse"), ["Old brand"]);
    });

    it("finds aisles with nothing on them, and suppliers only ever sent an order that was not received", async () => {
        const place = await seed_category("Sarees");
        const product = await seed_product("Cotton saree", place, { brand: await seed_brand("Aarong") });
        const warehouse = await seed_warehouse("Main");
        const stocked = await seed_aisle(warehouse, "A1");
        await seed_aisle(warehouse, "A2");
        const mill = await seed_supplier("Mill");
        const pending = await seed_supplier("Pending mill");
        await receive(mill, product, { warehouse, aisle: stocked });
        await receive(pending, product, { warehouse, status: "Submitted" });

        const { body } = await read(token);

        assert.deepEqual(check(body, "emptyAisles").items, [{ oid: check(body, "emptyAisles").items[0].oid, name: "A2", detail: "Main" }]);
        assert.deepEqual(names(body, "suppliersNeverBoughtFrom"), ["Pending mill"]);
    });
});

describe("how the catalogue is spread and stored", () => {
    let token;

    beforeEach(async () => {
        await h.reset();
        token = await sign_in_with(EVERYTHING);
    });

    it("shows the eight biggest categories and folds the rest into Other", async () => {
        for (let c = 1; c <= 10; c++) {
            const place = await seed_category(`Category ${String(c).padStart(2, "0")}`);
            for (let p = 0; p < 11 - c; p++) await seed_product(`Product ${c}-${p}`, place);
        }

        const { category } = (await read(token)).body.data.spread;

        assert.equal(category.total, 55);
        assert.equal(category.rows.length, 8);
        assert.deepEqual(category.rows[0], { oid: category.rows[0].oid, name: "Category 01", products: 10 });
        assert.deepEqual(category.other, { groups: 2, products: 3 });
    });

    it("counts a product bought from two suppliers under both, out of the products ever bought", async () => {
        const place = await seed_category("Sarees");
        const [shared, own] = [await seed_product("Shared", place), await seed_product("Own", place)];
        await seed_product("Never bought", place);
        const warehouse = await seed_warehouse("Main");
        const [mill, weaver] = [await seed_supplier("Mill"), await seed_supplier("Weaver")];
        await receive(mill, shared, { warehouse });
        await receive(mill, own, { warehouse });
        await receive(weaver, shared, { warehouse });

        const { supplier } = (await read(token)).body.data.spread;

        assert.equal(supplier.total, 2);
        assert.deepEqual(supplier.rows.map((r) => [r.name, r.products]), [["Mill", 2], ["Weaver", 1]]);
        assert.equal(supplier.other, null);
    });

    it("does not count a line verified at 0 as bought, from the supplier's products or its never bought from check", async () => {
        const place = await seed_category("Sarees");
        const [sent, never_sent] = [await seed_product("Sent", place), await seed_product("Never sent", place)];
        const warehouse = await seed_warehouse("Main");
        const [mill, empty_handed] = [await seed_supplier("Mill"), await seed_supplier("Empty handed")];
        await receive(mill, sent, { warehouse });
        await receive(mill, never_sent, { warehouse, quantity: 0 });
        await receive(empty_handed, sent, { warehouse, quantity: 0 });

        const { body } = await read(token);

        assert.equal(body.data.spread.supplier.total, 1);
        assert.deepEqual(body.data.spread.supplier.rows.map((r) => [r.name, r.products]), [["Mill", 1]]);
        assert.deepEqual(names(body, "suppliersNeverBoughtFrom"), ["Empty handed"]);
    });

    it("says how full each warehouse is against its capacity, and nothing for one without a capacity", async () => {
        const place = await seed_category("Sarees");
        const product = await seed_product("Cotton saree", place);
        const supplier = await seed_supplier("Mill");
        const main = await seed_warehouse("Main", 200);
        await seed_warehouse("Shop floor");
        await receive(supplier, product, { warehouse: main, quantity: 50 });

        const { warehouses } = (await read(token)).body.data;

        assert.deepEqual(warehouses.map(({ name, onHand, capacity, fullRate }) => ({ name, onHand, capacity, fullRate })), [
            { name: "Main", onHand: 50, capacity: 200, fullRate: 25 },
            { name: "Shop floor", onHand: 0, capacity: null, fullRate: null },
        ]);
    });

    it("counts what is active and what was added this month", async () => {
        await seed_category("Sarees");
        const old = await seed_category("Old");
        await h.query("UPDATE categories SET created_on = CURRENT_TIMESTAMP - INTERVAL '2 months' WHERE oid = $1", [old.category]);
        await seed_category("Hidden", "Inactive");

        const { category } = (await read(token)).body.data.counts;

        assert.deepEqual(category, { active: 2, added: 2 });
    });

    it("lists recent configuration changes only, and only for features the person can open", async () => {
        const log = (type, title) => h.query("INSERT INTO activity_log (oid, reference_type, reference_oid, title, performed_by) VALUES ($1, $2, $1, $3, 'owner')", [uuidv4(), type, title]);
        await log("category", "Created category");
        await log("supplier", "Created supplier");
        await log("settings", "Updated settings");
        await log("order", "Refund settled");

        const { activity } = (await read(await sign_in_with(["configuration.analytics.view", "configuration.category.view"]))).body.data;

        assert.deepEqual(activity.map((a) => a.action), ["Created category"]);
    });
});
