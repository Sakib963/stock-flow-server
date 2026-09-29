const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");
const { sign } = require("../../src/routes/configuration/product/utils/photo");
const { execute_transaction } = require("../../src/db/database");
const { restockStock } = require("../../src/routes/sales/utils/stock-movement");

const BASE = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.PRODUCT;
const LIST = BASE + ROUTES.GET_PRODUCT_LIST;
const CREATE = BASE + ROUTES.CREATE_PRODUCT;
const UPDATE = BASE + ROUTES.UPDATE_PRODUCT_DETAILS;
const DETAILS = BASE + ROUTES.GET_PRODUCT_DETAILS;
const DELETE = BASE + ROUTES.DELETE_PRODUCT;
const AVAILABILITY = BASE + ROUTES.CHECK_PRODUCT_AVAILABILITY;
const GENERATE_SKU = BASE + ROUTES.GENERATE_PRODUCT_SKU;
const SIGN_UPLOAD = BASE + ROUTES.SIGN_PRODUCT_PHOTO_UPLOAD;

const WRITER = ["configuration.product.view", "configuration.product.create", "configuration.product.edit", "configuration.product.delete"];
const CLOUD = "stockflow-test";
const PHOTO = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/stockflow/products/kurti.jpg`;

before(async () => {
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
    await h.start();
});
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });
const sign_in_with = async (permissions, email = `owner-${uuidv4().slice(0, 8)}@arithmalabs.test`) => (await h.sign_in(await h.seed_user({ email, permissions }))).access;

const seed_sub_category = async ({ status = "Active" } = {}) => {
    const [category, sub_category] = [uuidv4(), uuidv4()];
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, $1, $1, 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, $1, $1, $2, $3)", [sub_category, category, status]);
    return { category, sub_category };
};

const seed_product = async (name, { sku = null, threshold = 0, deleted = false } = {}) => {
    const { category, sub_category } = await seed_sub_category();
    const oid = uuidv4();
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, status, restock_threshold, is_deleted) VALUES ($1, $2, $3, $4, $5, 'Active', $6, $7)", [oid, name, sku, category, sub_category, threshold, deleted]);
    return oid;
};

const receive = async (product, quantity, { cost = 100, price = 150 } = {}) => {
    const [supplier, warehouse, purchase, line, batch] = [uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4()];
    await h.query("INSERT INTO supplier (oid, name, phone_number, status) VALUES ($1, $1, $2, 'Active')", [supplier, String(Date.now()) + Math.floor(Math.random() * 1000)]);
    await h.query("INSERT INTO warehouse (oid, name, code, status) VALUES ($1, $1, $1, 'Active')", [warehouse]);
    await h.query("INSERT INTO purchase (oid, supplier_oid, total_amount, paid_amount, status) VALUES ($1, $2, 0, 0, 'Verified')", [purchase, supplier]);
    await h.query("INSERT INTO purchase_details (oid, purchase_oid, product_oid, warehouse_oid, ordered_quantity, verified_quantity, ordered_unit_price) VALUES ($1, $2, $3, $4, $5, $5, $6)", [line, purchase, product, warehouse, quantity, cost]);
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, purchase_details_oid, initial_quantity, quantity_available, cost_price, selling_price, status) VALUES ($1, $1, $2, $3, $4, $4, $5, $6, 'ready_for_sale')", [batch, product, line, quantity, cost, price]);
    return batch;
};

const order = async (product, status, { batch = null, hold = 0, quantity = 1 } = {}) => {
    const [oid, item] = [uuidv4(), uuidv4()];
    await h.query("INSERT INTO orders (oid, invoice_no, total_amount, status, channel) VALUES ($1, $1, 0, $2, $3)", [oid, status, hold ? "ONLINE" : "POS"]);
    await h.query("INSERT INTO order_items (oid, order_oid, product_oid, product_name, quantity, unit_price, total) VALUES ($1, $2, $3, 'x', $4, 150, 150)", [item, oid, product, quantity]);
    if (hold) await h.query("INSERT INTO stock_hold (oid, order_oid, inventory_oid, product_oid, quantity) VALUES ($1, $2, $3, $4, $5)", [uuidv4(), oid, batch, product, hold]);
    return oid;
};

const fields = (sub_category, extra = {}) => ({ name: "Cotton Kurti", sub_category_oid: sub_category, restock_threshold: 5, status: "Active", ...extra });

beforeEach(async () => {
    await h.reset();
    await h.query("TRUNCATE product, product_stats, inventory, stock_hold, orders, order_items, purchase, purchase_details CASCADE");
});

describe("adding a product", () => {
    it("makes a SKU from the name when none is typed, and keeps a typed one in capitals", async () => {
        const author = await sign_in_with(WRITER);
        const { sub_category } = await seed_sub_category();

        const made = await post(CREATE, author, fields(sub_category));
        const typed = await post(CREATE, author, fields(sub_category, { name: "Scarf", sku: "8901030 " }));
        const lower = await post(CREATE, author, fields(sub_category, { name: "Bag", sku: "bag-01" }));

        assert.equal(made.status, 200);
        const rows = await h.query("SELECT oid, sku FROM product WHERE oid = ANY($1)", [[made.body.data.oid, typed.body.data.oid, lower.body.data.oid]]);
        const sku = Object.fromEntries(rows.map((r) => [r.oid, r.sku]));
        assert.equal(sku[made.body.data.oid], "COTTKUR");
        assert.equal(sku[typed.body.data.oid], "8901030");
        assert.equal(sku[lower.body.data.oid], "BAG-01");
    });

    it("gives the second product of the same name the next free SKU", async () => {
        const author = await sign_in_with(WRITER);
        const { sub_category } = await seed_sub_category();

        await post(CREATE, author, fields(sub_category));
        const second = await post(CREATE, author, fields(sub_category));

        const [row] = await h.query("SELECT sku FROM product WHERE oid = $1", [second.body.data.oid]);
        assert.equal(row.sku, "COTTKURT");
    });

    it("refuses a SKU another product already has, whatever its case, and says which field", async () => {
        const author = await sign_in_with(WRITER);
        await seed_product("Saree", { sku: "SAR-1" });
        const { sub_category } = await seed_sub_category();

        const res = await post(CREATE, author, fields(sub_category, { sku: "sar-1" }));

        assert.equal(res.status, 409);
        assert.equal(res.body.data.field, "sku");
    });

    it("lets a new product take the SKU of a deleted one", async () => {
        const author = await sign_in_with(WRITER);
        await seed_product("Old Saree", { sku: "SAR-1", deleted: true });
        const { sub_category } = await seed_sub_category();

        assert.equal((await post(CREATE, author, fields(sub_category, { sku: "SAR-1" }))).status, 200);
    });

    it("refuses an Inactive sub-category", async () => {
        const author = await sign_in_with(WRITER);
        const { sub_category } = await seed_sub_category({ status: "Inactive" });

        const res = await post(CREATE, author, fields(sub_category));

        assert.equal(res.status, 400);
        assert.equal(res.body.data.field, "sub_category_oid");
    });

    it("keeps a photo from our own Cloudinary account and refuses one from anywhere else", async () => {
        const author = await sign_in_with(WRITER);
        const { sub_category } = await seed_sub_category();

        const ours = await post(CREATE, author, fields(sub_category, { photo: PHOTO }));
        const theirs = await post(CREATE, author, fields(sub_category, { name: "Other", photo: "https://example.com/kurti.jpg" }));

        assert.equal(ours.status, 200);
        assert.equal(theirs.status, 400);
    });

    it("records the new product in the activity log and starts its lifetime counts at zero", async () => {
        const author = await sign_in_with(WRITER);
        const { sub_category } = await seed_sub_category();

        const oid = (await post(CREATE, author, fields(sub_category))).body.data.oid;

        const [log] = await h.query("SELECT title FROM activity_log WHERE reference_oid = $1", [oid]);
        assert.equal(log.title, "Created product");
        assert.equal((await h.query("SELECT 1 FROM product_stats WHERE product_oid = $1", [oid])).length, 1);
    });
});

describe("editing a product", () => {
    it("writes nothing when nothing changed", async () => {
        const author = await sign_in_with(WRITER);
        const { sub_category } = await seed_sub_category();
        const oid = (await post(CREATE, author, fields(sub_category, { sku: "KUR-1" }))).body.data.oid;

        const res = await post(UPDATE, author, { oid, ...fields(sub_category, { sku: "KUR-1" }) });

        assert.equal(res.body.data.changed, false);
        assert.equal((await h.query("SELECT 1 FROM activity_log WHERE reference_oid = $1 AND title = 'Updated product'", [oid])).length, 0);
    });

    it("still saves a product whose sub-category has since been turned Inactive", async () => {
        const author = await sign_in_with(WRITER);
        const { sub_category } = await seed_sub_category();
        const oid = (await post(CREATE, author, fields(sub_category))).body.data.oid;
        await h.query("UPDATE sub_categories SET status = 'Inactive' WHERE oid = $1", [sub_category]);

        const res = await post(UPDATE, author, { oid, ...fields(sub_category, { restock_threshold: 9 }) });

        assert.equal(res.status, 200);
        const [log] = await h.query("SELECT description FROM activity_log WHERE reference_oid = $1 AND title = 'Updated product'", [oid]);
        assert.match(log.description, /Restock level/);
    });

    it("gives an old product without a SKU one when it is saved blank", async () => {
        const author = await sign_in_with(WRITER);
        const oid = await seed_product("Woolen Scarf");
        const [{ sub_category_oid }] = await h.query("SELECT sub_category_oid FROM product WHERE oid = $1", [oid]);

        await post(UPDATE, author, { oid, ...fields(sub_category_oid, { name: "Woolen Scarf" }) });

        const [row] = await h.query("SELECT sku FROM product WHERE oid = $1", [oid]);
        assert.equal(row.sku, "WOOLSCA");
    });
});

describe("deleting a product", () => {
    it("refuses while it still has stock on the shelf", async () => {
        const author = await sign_in_with(WRITER);
        const oid = await seed_product("Saree");
        await receive(oid, 4);

        const res = await post(DELETE, author, { oid });

        assert.equal(res.status, 409);
        assert.equal(res.body.data.reason, "in_stock");
        assert.equal((await h.query("SELECT is_deleted FROM product WHERE oid = $1", [oid]))[0].is_deleted, false);
    });

    it("refuses while an online order is holding it", async () => {
        const author = await sign_in_with(WRITER);
        const oid = await seed_product("Saree");
        const batch = await receive(oid, 2);
        await order(oid, "Confirmed", { batch, hold: 2 });

        const res = await post(DELETE, author, { oid });

        assert.equal(res.status, 409);
        assert.equal(res.body.data.reason, "held");
    });

    it("refuses while a purchase order for it has not been received, since receiving it would put stock on a deleted product", async () => {
        const author = await sign_in_with(WRITER);
        const oid = await seed_product("Saree");
        const [supplier, warehouse, purchase] = [uuidv4(), uuidv4(), uuidv4()];
        await h.query("INSERT INTO supplier (oid, name, phone_number, status) VALUES ($1, $1, '01711111111', 'Active')", [supplier]);
        await h.query("INSERT INTO warehouse (oid, name, code, status) VALUES ($1, $1, $1, 'Active')", [warehouse]);
        await h.query("INSERT INTO purchase (oid, supplier_oid, total_amount, paid_amount, status) VALUES ($1, $2, 0, 0, 'Submitted')", [purchase, supplier]);
        await h.query("INSERT INTO purchase_details (oid, purchase_oid, product_oid, warehouse_oid, ordered_quantity, ordered_unit_price) VALUES ($1, $2, $3, $4, 10, 100)", [uuidv4(), purchase, oid, warehouse]);

        const res = await post(DELETE, author, { oid });

        assert.equal(res.status, 409);
        assert.equal(res.body.data.reason, "on_order");
        assert.equal((await h.query("SELECT is_deleted FROM product WHERE oid = $1", [oid]))[0].is_deleted, false);
    });

    it("deletes a product with nothing left, keeps its row, and drops it from the list", async () => {
        const author = await sign_in_with(WRITER);
        const oid = await seed_product("Saree");
        const batch = await receive(oid, 1);
        await h.query("UPDATE inventory SET quantity_available = 0 WHERE oid = $1", [batch]);

        const res = await post(DELETE, author, { oid });

        assert.equal(res.status, 200);
        assert.equal((await h.query("SELECT is_deleted FROM product WHERE oid = $1", [oid]))[0].is_deleted, true);
        assert.equal((await get(LIST, author)).body.total, 0);
        assert.equal((await h.query("SELECT 1 FROM activity_log WHERE reference_oid = $1 AND title = 'Deleted product'", [oid])).length, 1);
    });
});

describe("the product list and record", () => {
    it("never counts internal use or unpriced stock as sellable, while still showing it in the warehouse", async () => {
        const author = await sign_in_with(WRITER);
        const bags = await seed_product("Shopping Bag");
        const packing = await receive(bags, 40);
        await h.query("UPDATE inventory SET status = 'internal_use', selling_price = NULL WHERE oid = $1", [packing]);
        const unpriced = await receive(bags, 5);
        await h.query("UPDATE inventory SET status = 'pending_pricing' WHERE oid = $1", [unpriced]);

        const row = (await get(LIST, author)).body.data.rows.find((r) => r.oid === bags);
        const { stock } = (await get(`${DETAILS}/${bags}`, author)).body.data;

        assert.equal(row.sellable, 0);
        assert.deepEqual({ on_hand: stock.on_hand, sellable: stock.sellable }, { on_hand: 45, sellable: 0 });
    });

    it("puts no stock back on a deleted product", async () => {
        const oid = await seed_product("Saree");
        const batch = await receive(oid, 1);
        await h.query("UPDATE inventory SET quantity_available = 0 WHERE oid = $1", [batch]);
        await h.query("UPDATE product SET is_deleted = TRUE WHERE oid = $1", [oid]);

        await assert.rejects(execute_transaction((tx) => restockStock(tx, { inventory_oid: batch, quantity: 1, user_id: "owner@arithmalabs.test" })), (e) => e.code === 409 && e.data.reason === "product_deleted");
        assert.equal((await h.query("SELECT quantity_available::int AS q FROM inventory WHERE oid = $1", [batch]))[0].q, 0);
    });


    it("shows what can be sold, not what is on the shelf, and counts low and out of stock from it", async () => {
        const author = await sign_in_with(WRITER);
        const held = await seed_product("Saree", { threshold: 5 });
        const batch = await receive(held, 12);
        await order(held, "Confirmed", { batch, hold: 8 });
        await seed_product("Scarf");

        const res = await get(LIST, author, { include: "stats" });

        const saree = res.body.data.rows.find((r) => r.oid === held);
        assert.equal(saree.sellable, 4);
        assert.deepEqual(res.body.data.stats, { active: 2, inactive: 0, low: 1, out: 1 });
    });

    it("finds a product by its SKU", async () => {
        const author = await sign_in_with(WRITER);
        await seed_product("Saree", { sku: "SAR-1" });
        await seed_product("Scarf", { sku: "SCA-1" });

        const res = await get(LIST, author, { search: "sar-1" });

        assert.deepEqual(res.body.data.rows.map((r) => r.sku), ["SAR-1"]);
    });

    it("hands the list a small thumbnail of the photo", async () => {
        const author = await sign_in_with(WRITER);
        const oid = await seed_product("Kurti");
        await h.query("UPDATE product SET photo = $1 WHERE oid = $2", [PHOTO, oid]);

        const [row] = (await get(LIST, author)).body.data.rows;

        assert.equal(row.photo_thumb, `https://res.cloudinary.com/${CLOUD}/image/upload/c_fill,w_48,h_48,f_auto,q_auto/v1/stockflow/products/kurti.jpg`);
    });

    it("gives the record its stock by batch and the last time it was actually sold", async () => {
        const author = await sign_in_with(WRITER);
        const oid = await seed_product("Saree");
        const batch = await receive(oid, 10);
        await receive(oid, 3);
        await order(oid, "Confirmed", { batch, hold: 4 });
        const sold = await order(oid, "Purchased");
        await h.query("UPDATE orders SET created_on = '2026-08-25 10:00', sold_on = '2026-09-01 10:00' WHERE oid = $1", [sold]);
        const intended = await order(oid, "Pending");
        await h.query("UPDATE orders SET created_on = '2026-09-20 10:00' WHERE oid = $1", [intended]);

        const res = await get(`${DETAILS}/${oid}`, author);

        const { stock, lifetime } = res.body.data;
        assert.deepEqual({ on_hand: stock.on_hand, held: stock.held, sellable: stock.sellable }, { on_hand: 13, held: 4, sellable: 9 });
        assert.equal(stock.batches.length, 2);
        assert.equal(new Date(lifetime.last_sold_on).getDate(), 1);
    });

    it("answers 404 for a deleted product", async () => {
        const author = await sign_in_with(WRITER);
        const oid = await seed_product("Saree", { deleted: true });

        assert.equal((await get(`${DETAILS}/${oid}`, author)).status, 404);
    });
});

describe("SKU helpers", () => {
    it("answers taken for another product's SKU and free for the product's own", async () => {
        const author = await sign_in_with(WRITER);
        const oid = await seed_product("Saree", { sku: "SAR-1" });

        assert.equal((await get(AVAILABILITY, author, { value: "sar-1 " })).body.data.available, false);
        assert.equal((await get(AVAILABILITY, author, { value: "SAR-1", oid })).body.data.available, true);
    });

    it("suggests the first SKU no live product holds", async () => {
        const author = await sign_in_with(WRITER);
        await seed_product("Cotton Kurti", { sku: "COTTKUR" });

        assert.equal((await get(GENERATE_SKU, author, { name: "Cotton Kurti" })).body.data.sku, "COTTKURT");
    });
});

describe("photo upload", () => {
    it("is refused with a plain reason until the server holds Cloudinary credentials", async () => {
        const author = await sign_in_with(WRITER);
        delete process.env.CLOUDINARY_API_KEY;
        delete process.env.CLOUDINARY_API_SECRET;

        assert.equal((await post(SIGN_UPLOAD, author, {})).status, 503);
    });

    it("signs an upload into the products folder only", async () => {
        const author = await sign_in_with(WRITER);
        process.env.CLOUDINARY_API_KEY = "key";
        process.env.CLOUDINARY_API_SECRET = "secret";

        const { data } = (await post(SIGN_UPLOAD, author, {})).body;

        assert.equal(data.folder, "stockflow/products");
        assert.equal(data.signature, crypto.createHash("sha1").update(`folder=stockflow/products&timestamp=${data.timestamp}secret`).digest("hex"));
        assert.equal(sign({ timestamp: 1, folder: "a" }, "s"), sign({ folder: "a", timestamp: 1 }, "s"));
        delete process.env.CLOUDINARY_API_KEY;
        delete process.env.CLOUDINARY_API_SECRET;
    });
});

describe("who may do what", () => {
    it("refuses each action to someone who only holds view", async () => {
        const viewer = await sign_in_with(["configuration.product.view"]);
        const oid = await seed_product("Saree");
        const { sub_category } = await seed_sub_category();

        assert.equal((await post(CREATE, viewer, fields(sub_category))).status, 403);
        assert.equal((await post(UPDATE, viewer, { oid, ...fields(sub_category) })).status, 403);
        assert.equal((await post(DELETE, viewer, { oid })).status, 403);
        assert.equal((await post(SIGN_UPLOAD, viewer, {})).status, 403);
    });

    it("refuses the list to someone without view", async () => {
        const other = await sign_in_with(["dashboard.overview.view"]);
        assert.equal((await get(LIST, other)).status, 403);
    });

    it("lets someone who only manages products load the category, sub-category and brand pickers", async () => {
        const viewer = await sign_in_with(["configuration.product.view"]);

        assert.equal((await get(CONTEXTS.CONFIGURATION + SUB_CONTEXTS.CATEGORY + ROUTES.GET_CATEGORY_LIST_FOR_DROPDOWN, viewer)).status, 200);
        assert.equal((await get(CONTEXTS.CONFIGURATION + SUB_CONTEXTS.SUB_CATEGORY + ROUTES.GET_SUB_CATEGORY_LIST_FOR_DROPDOWN, viewer)).status, 200);
        assert.equal((await get(CONTEXTS.CONFIGURATION + SUB_CONTEXTS.BRANDS + ROUTES.GET_BRANDS_LIST_FOR_DROPDOWN, viewer)).status, 200);
    });
});
