const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.BRANDS;
const LIST = BASE + ROUTES.GET_BRANDS_LIST;
const CREATE = BASE + ROUTES.CREATE_BRANDS;
const UPDATE = BASE + ROUTES.UPDATE_BRANDS_DETAILS;
const DETAILS = BASE + ROUTES.GET_BRANDS_DETAILS;
const AVAILABILITY = BASE + ROUTES.CHECK_BRAND_AVAILABILITY;
const DROPDOWN = BASE + ROUTES.GET_BRANDS_LIST_FOR_DROPDOWN;
const PRODUCT_REPORT = BASE + ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_BRAND;
const INVENTORY_REPORT = BASE + ROUTES.GENERATE_INVENTORY_REPORT_BY_BRAND;

const WRITER = ["configuration.brands.view", "configuration.brands.create", "configuration.brands.edit"];

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });

const seed_brand = async (name, status = "Active") => {
    const oid = uuidv4();
    await h.query("INSERT INTO brands (oid, name, status) VALUES ($1, $2, $3)", [oid, name, status]);
    return oid;
};

// A product needs a category and a sub-category; the brand is what these tests look at.
const seed_product = async (brand_oid, { deleted = false } = {}) => {
    const [category, sub_category, oid] = [uuidv4(), uuidv4(), uuidv4()];
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, $1, $1, 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, $1, $1, $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, brand_oid, status, is_deleted) VALUES ($1, 'Lipstick', $2, $3, $4, 'Active', $5)", [oid, category, sub_category, brand_oid, deleted]);
    return oid;
};

// A fresh address each time: the server caches a caller's grants by email for two minutes.
const sign_in_with = async (permissions, email = `owner-${uuidv4().slice(0, 8)}@arithmalabs.test`) => (await h.sign_in(await h.seed_user({ email, permissions }))).access;

describe("creating and editing a brand", () => {
    let author;

    beforeEach(async () => {
        await h.reset();
        author = await sign_in_with(WRITER);
    });

    it("creates a brand and hands back its oid, storing an empty description as none", async () => {
        const res = await post(CREATE, author, { name: "Aarong", description: "", status: "Active" });

        assert.equal(res.status, 200);
        const [row] = await h.query("SELECT name, description FROM brands WHERE oid = $1", [res.body.data.oid]);
        assert.deepEqual(row, { name: "Aarong", description: null });
    });

    it("keeps the country of origin as a two letter code, and refuses anything else", async () => {
        const res = await post(CREATE, author, { name: "Cosrx", origin_country: "kr", status: "Active" });
        const bad = await post(CREATE, author, { name: "Other", origin_country: "Korea", status: "Active" });

        assert.equal(res.status, 200);
        const [row] = await h.query("SELECT origin_country FROM brands WHERE oid = $1", [res.body.data.oid]);
        assert.equal(row.origin_country, "KR");
        assert.equal(bad.status, 400);
    });

    it("records a change of origin in the activity log", async () => {
        const oid = (await post(CREATE, author, { name: "Cosrx", status: "Active" })).body.data.oid;
        await post(UPDATE, author, { oid, name: "Cosrx", origin_country: "KR", status: "Active" });

        const [log] = await h.query("SELECT description FROM activity_log WHERE reference_oid = $1 AND title = 'Updated brand'", [oid]);
        assert.match(log.description, /KR/);
    });

    it("refuses a second brand of the same name, whatever its case", async () => {
        await seed_brand("Aarong");

        const res = await post(CREATE, author, { name: "  aarong ", status: "Active" });

        assert.equal(res.status, 409);
        assert.equal(res.body.data.field, "name");
    });

    it("lets exactly one of two simultaneous creates of the same name through", async () => {
        const results = await Promise.all([post(CREATE, author, { name: "Yellow", status: "Active" }), post(CREATE, author, { name: "Yellow", status: "Active" })]);

        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        const [{ n }] = await h.query("SELECT count(*)::int AS n FROM brands WHERE name = 'Yellow'");
        assert.equal(n, 1);
    });

    it("refuses renaming a brand to a name another brand holds", async () => {
        await seed_brand("Aarong");
        const oid = await seed_brand("Yellow");

        const res = await post(UPDATE, author, { oid, name: "AARONG", status: "Active" });

        assert.equal(res.status, 409);
    });

    it("answers 404 for a brand that no longer exists", async () => {
        const res = await post(UPDATE, author, { oid: uuidv4(), name: "Ghost", status: "Active" });
        assert.equal(res.status, 404);
    });

    it("records the change in the activity log", async () => {
        const created = await post(CREATE, author, { name: "Aarong", status: "Active" });
        const oid = created.body.data.oid;
        await post(UPDATE, author, { oid, name: "Aarong", status: "Inactive" });

        const rows = await h.query("SELECT title FROM activity_log WHERE reference_type = 'brand' AND reference_oid = $1 ORDER BY performed_on", [oid]);
        assert.deepEqual(rows.map((r) => r.title), ["Created brand", "Updated brand"]);
    });

    it("writes nothing and logs nothing when an untouched brand is saved", async () => {
        const created = await post(CREATE, author, { name: "Aarong", description: "Handloom", status: "Active" });
        const oid = created.body.data.oid;

        const res = await post(UPDATE, author, { oid, name: "Aarong", description: "Handloom", status: "Active" });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.changed, false);
        const [row] = await h.query("SELECT edited_by FROM brands WHERE oid = $1", [oid]);
        assert.equal(row.edited_by, null);
        const logs = await h.query("SELECT title FROM activity_log WHERE reference_oid = $1", [oid]);
        assert.deepEqual(logs.map((r) => r.title), ["Created brand"]);
    });

    it("refuses someone holding view alone", async () => {
        const viewer = await sign_in_with(["configuration.brands.view"], `counter-${uuidv4().slice(0, 8)}@arithmalabs.test`);
        const res = await post(CREATE, viewer, { name: "Aarong", status: "Active" });
        assert.equal(res.status, 403);
    });
});

describe("asking whether a brand name is free", () => {
    it("answers taken for another brand's name and free for the brand's own", async () => {
        await h.reset();
        const author = await sign_in_with(WRITER);
        const oid = await seed_brand("Aarong");

        assert.equal((await get(AVAILABILITY, author, { value: "AARONG " })).body.data.available, false);
        assert.equal((await get(AVAILABILITY, author, { value: "Aarong", oid })).body.data.available, true);
    });
});

describe("the brands list and record", () => {
    let viewer;
    let aarong;

    beforeEach(async () => {
        await h.reset();
        viewer = await sign_in_with(["configuration.brands.view"]);
        aarong = await seed_brand("Aarong");
        await seed_brand("Yellow", "Inactive");
        await seed_brand("Kay Kraft");
        await seed_product(aarong);
        await seed_product(aarong, { deleted: true });
    });

    it("counts the stat cards over products that are not deleted", async () => {
        const res = await get(LIST, viewer, { include: "stats" });

        assert.equal(res.status, 200);
        assert.equal(res.body.total, 3);
        assert.deepEqual(res.body.data.stats, { active: 2, inactive: 1, products: 1, empty: 2 });
    });

    it("filters by status", async () => {
        const res = await get(LIST, viewer, { status: "Inactive" });
        assert.deepEqual(res.body.data.rows.map((r) => r.name), ["Yellow"]);
    });

    it("opens a record counting only its own products that are not deleted", async () => {
        const res = await h.call(`${DETAILS}/${aarong}`, { method: "GET", token: viewer });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.details.name, "Aarong");
        assert.equal(res.body.data.stats.totalProducts, 1);
    });

    it("offers only Active brands in its picker", async () => {
        const res = await get(DROPDOWN, viewer);
        assert.deepEqual(res.body.data.map((r) => r.label), ["Aarong", "Kay Kraft"]);
    });

    it("keeps both reports from someone who may only view", async () => {
        assert.equal((await post(PRODUCT_REPORT, viewer, { oid: aarong })).status, 403);
        assert.equal((await post(INVENTORY_REPORT, viewer, { oid: aarong })).status, 403);
    });

    it("refuses the list to someone without view", async () => {
        const other = await sign_in_with(["dashboard.overview.view"], `counter-${uuidv4().slice(0, 8)}@arithmalabs.test`);
        assert.equal((await get(LIST, other)).status, 403);
    });
});
