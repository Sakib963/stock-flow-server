const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.SUB_CATEGORY;
const LIST = BASE + ROUTES.GET_SUB_CATEGORY_LIST;
const CREATE = BASE + ROUTES.CREATE_SUB_CATEGORY;
const UPDATE = BASE + ROUTES.UPDATE_SUB_CATEGORY_DETAILS;
const DETAILS = BASE + ROUTES.GET_SUB_CATEGORY_DETAILS;
const AVAILABILITY = BASE + ROUTES.CHECK_SUB_CATEGORY_AVAILABILITY;
const GENERATE = BASE + ROUTES.GENERATE_SUB_CATEGORY_CODE;
const DROPDOWN = BASE + ROUTES.GET_SUB_CATEGORY_LIST_FOR_DROPDOWN;
const PRODUCT_REPORT = BASE + ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_SUB_CATEGORY;
const CATEGORY_DROPDOWN = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.CATEGORY + ROUTES.GET_CATEGORY_LIST_FOR_DROPDOWN;

const WRITER = ["configuration.sub-category.view", "configuration.sub-category.create", "configuration.sub-category.edit"];

before(h.start);
after(h.stop);

const get = (route, token, params = {}) => h.call(`${route}?${new URLSearchParams(params)}`, { method: "GET", token });
const post = (route, token, body) => h.call(route, { method: "POST", token, body });

const seed_category = async (name, code, status = "Active") => {
    const oid = uuidv4();
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, $2, $3, $4)", [oid, name, code, status]);
    return oid;
};

const seed_sub_category = async (category_oid, name, code, status = "Active") => {
    const oid = uuidv4();
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, $2, $3, $4, $5)", [oid, name, code, category_oid, status]);
    return oid;
};

const seed_product = async (category_oid, sub_category_oid, { deleted = false } = {}) => {
    const oid = uuidv4();
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, status, is_deleted) VALUES ($1, 'Cotton saree', $2, $3, 'Active', $4)", [oid, category_oid, sub_category_oid, deleted]);
    return oid;
};

// A fresh address each time: the server caches a caller's grants by email for two minutes, so one address
// reused across tests with different grants is answered from the earlier test.
const sign_in_with = async (permissions, email = `owner-${uuidv4().slice(0, 8)}@samiha.test`) => (await h.sign_in(await h.seed_user({ email, permissions }))).access;

describe("creating and editing a sub-category", () => {
    let author;
    let clothing;
    let footwear;

    beforeEach(async () => {
        await h.reset();
        author = await sign_in_with(WRITER);
        clothing = await seed_category("Clothing", "CLOT");
        footwear = await seed_category("Footwear", "FOOT");
    });

    it("creates a sub-category under its category and hands back its oid", async () => {
        const res = await post(CREATE, author, { name: "Sarees", category_code: "sare", category_oid: clothing, description: "", status: "Active" });

        assert.equal(res.status, 200);
        const [row] = await h.query("SELECT name, category_code, category_oid, description FROM sub_categories WHERE oid = $1", [res.body.data.oid]);
        assert.deepEqual(row, { name: "Sarees", category_code: "SARE", category_oid: clothing, description: null });
    });

    it("refuses a second sub-category of the same name under the same category, whatever its case", async () => {
        await seed_sub_category(clothing, "Men", "MENC");

        const res = await post(CREATE, author, { name: "  men ", category_code: "MENX", category_oid: clothing, status: "Active" });

        assert.equal(res.status, 409);
        assert.equal(res.body.data.field, "name");
    });

    it("allows the same name under a different category", async () => {
        await seed_sub_category(clothing, "Men", "MENC");

        const res = await post(CREATE, author, { name: "Men", category_code: "MENF", category_oid: footwear, status: "Active" });

        assert.equal(res.status, 200);
    });

    it("refuses a code another sub-category holds, under any category", async () => {
        await seed_sub_category(clothing, "Men", "MEN");

        const res = await post(CREATE, author, { name: "Women", category_code: "men", category_oid: footwear, status: "Active" });

        assert.equal(res.status, 409);
        assert.equal(res.body.data.field, "category_code");
    });

    it("lets exactly one of two simultaneous creates of the same name through", async () => {
        const body = (code) => ({ name: "Kids", category_code: code, category_oid: clothing, status: "Active" });
        const results = await Promise.all([post(CREATE, author, body("KIDA")), post(CREATE, author, body("KIDB"))]);

        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        const [{ n }] = await h.query("SELECT count(*)::int AS n FROM sub_categories WHERE name = 'Kids'");
        assert.equal(n, 1);
    });

    it("refuses an Inactive or missing parent category", async () => {
        const retired = await seed_category("Retired", "RETI", "Inactive");

        const inactive = await post(CREATE, author, { name: "Old", category_code: "OLD", category_oid: retired, status: "Active" });
        const missing = await post(CREATE, author, { name: "Old", category_code: "OLD", category_oid: uuidv4(), status: "Active" });

        assert.equal(inactive.status, 400);
        assert.equal(inactive.body.data.field, "category_oid");
        assert.equal(missing.status, 400);
    });

    it("keeps a sub-category under a parent turned Inactive when it is edited without moving", async () => {
        const retired = await seed_category("Retired", "RETI", "Inactive");
        const oid = await seed_sub_category(retired, "Old", "OLD");

        const kept = await post(UPDATE, author, { oid, name: "Old stock", category_code: "OLD", category_oid: retired, status: "Active" });
        const moved = await post(UPDATE, author, { oid, name: "Old stock", category_code: "OLD", category_oid: clothing, status: "Active" });
        const back = await post(UPDATE, author, { oid, name: "Old stock", category_code: "OLD", category_oid: retired, status: "Active" });

        assert.equal(kept.status, 200);
        assert.equal(moved.status, 200);
        assert.equal(back.status, 400, "moving to an Inactive category is a new choice");
    });

    it("takes its products along when it moves to another category", async () => {
        const oid = await seed_sub_category(clothing, "Kurtis", "KURT");
        const product = await seed_product(clothing, oid);

        const res = await post(UPDATE, author, { oid, name: "Kurtis", category_code: "KURT", category_oid: footwear, status: "Active" });

        assert.equal(res.status, 200);
        const [row] = await h.query("SELECT category_oid FROM product WHERE oid = $1", [product]);
        assert.equal(row.category_oid, footwear);
    });

    it("answers 404 for a sub-category that no longer exists", async () => {
        const res = await post(UPDATE, author, { oid: uuidv4(), name: "Ghost", category_code: "GHOS", category_oid: clothing, status: "Active" });
        assert.equal(res.status, 404);
    });

    it("records the change in the activity log", async () => {
        const created = await post(CREATE, author, { name: "Sarees", category_code: "SARE", category_oid: clothing, status: "Active" });
        const oid = created.body.data.oid;
        await post(UPDATE, author, { oid, name: "Sarees", category_code: "SARE", category_oid: clothing, status: "Inactive" });

        const rows = await h.query("SELECT title FROM activity_log WHERE reference_type = 'sub-category' AND reference_oid = $1 ORDER BY performed_on", [oid]);
        assert.deepEqual(rows.map((r) => r.title), ["Created sub-category", "Updated sub-category"]);
    });

    it("refuses someone holding view alone", async () => {
        const viewer = await sign_in_with(["configuration.sub-category.view"], `counter-${uuidv4().slice(0, 8)}@samiha.test`);
        const res = await post(CREATE, viewer, { name: "Sarees", category_code: "SARE", category_oid: clothing, status: "Active" });
        assert.equal(res.status, 403);
    });
});

describe("asking whether a sub-category name or code is free", () => {
    let author;
    let clothing;
    let footwear;

    beforeEach(async () => {
        await h.reset();
        author = await sign_in_with(WRITER);
        clothing = await seed_category("Clothing", "CLOT");
        footwear = await seed_category("Footwear", "FOOT");
        await seed_sub_category(clothing, "Men", "MENC");
    });

    it("answers a name within its category only", async () => {
        const taken = await get(AVAILABILITY, author, { field: "name", value: "MEN ", category_oid: clothing });
        const free = await get(AVAILABILITY, author, { field: "name", value: "Men", category_oid: footwear });

        assert.equal(taken.body.data.available, false);
        assert.equal(free.body.data.available, true);
    });

    it("needs the category for a name, and answers a code across every category", async () => {
        assert.equal((await get(AVAILABILITY, author, { field: "name", value: "Men" })).status, 400);
        assert.equal((await get(AVAILABILITY, author, { field: "category_code", value: "menc" })).body.data.available, false);
    });

    it("generates a code no other sub-category holds", async () => {
        await seed_sub_category(footwear, "Sneakers", "SNEA");
        const res = await get(GENERATE, author, { name: "Sneakers" });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.category_code, "SNEAK");
    });
});

describe("the sub-categories list and record", () => {
    let viewer;
    let clothing;
    let footwear;
    let sarees;

    beforeEach(async () => {
        await h.reset();
        viewer = await sign_in_with(["configuration.sub-category.view"]);
        clothing = await seed_category("Clothing", "CLOT");
        footwear = await seed_category("Footwear", "FOOT");
        sarees = await seed_sub_category(clothing, "Sarees", "SARE");
        await seed_sub_category(clothing, "Kurtis", "KURT", "Inactive");
        await seed_sub_category(footwear, "Sneakers", "SNEA");
        await seed_product(clothing, sarees);
        await seed_product(clothing, sarees, { deleted: true });
    });

    it("filters by category and carries the parent's name on each row", async () => {
        const res = await get(LIST, viewer, { category_oid: clothing, include: "stats" });

        assert.equal(res.status, 200);
        assert.equal(res.body.total, 2);
        assert.ok(res.body.data.rows.every((row) => row.category_name === "Clothing"));
        assert.deepEqual(res.body.data.stats, { active: 1, inactive: 1, products: 1, empty: 1 });
    });

    it("filters by status and category together", async () => {
        const res = await get(LIST, viewer, { category_oid: clothing, status: "Active" });
        assert.deepEqual(res.body.data.rows.map((r) => r.name), ["Sarees"]);
    });

    it("finds a sub-category by its category's name", async () => {
        const res = await get(LIST, viewer, { search: "footw" });
        assert.deepEqual(res.body.data.rows.map((r) => r.name), ["Sneakers"]);
    });

    it("opens a record with its parent and counts only its own products that are not deleted", async () => {
        const res = await h.call(`${DETAILS}/${sarees}`, { method: "GET", token: viewer });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.details.category_name, "Clothing");
        assert.equal(res.body.data.stats.totalProducts, 1);
    });

    it("offers only Active sub-categories under Active categories in its picker", async () => {
        const res = await get(DROPDOWN, viewer);
        assert.deepEqual(res.body.data.map((r) => r.label), ["Sarees", "Sneakers"]);
    });

    it("keeps both reports from someone who may only view", async () => {
        const res = await post(PRODUCT_REPORT, viewer, { oid: sarees });
        assert.equal(res.status, 403);
    });

    it("refuses the list to someone without view", async () => {
        const other = await sign_in_with(["dashboard.overview.view"], `counter-${uuidv4().slice(0, 8)}@samiha.test`);
        assert.equal((await get(LIST, other)).status, 403);
    });
});

describe("the category picker behind the sub-category form", () => {
    beforeEach(async () => {
        await h.reset();
        await seed_category("Clothing", "CLOT");
        await seed_category("Retired", "RETI", "Inactive");
    });

    it("opens to someone holding sub-category view without category view", async () => {
        const access = await sign_in_with(["configuration.sub-category.view"]);
        const res = await get(CATEGORY_DROPDOWN, access);

        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data.map((r) => r.label), ["Clothing"]);
    });

    it("stays closed to someone holding neither view", async () => {
        const access = await sign_in_with(["configuration.brands.view"]);
        assert.equal((await get(CATEGORY_DROPDOWN, access)).status, 403);
    });
});
