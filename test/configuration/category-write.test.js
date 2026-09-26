const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");
const { buildCandidates } = require("../../src/routes/configuration/utils/code-generator");

const BASE = CONTEXTS.CONFIGURATION + SUB_CONTEXTS.CATEGORY;
const CREATE = BASE + ROUTES.CREATE_CATEGORY;
const UPDATE = BASE + ROUTES.UPDATE_CATEGORY_DETAILS;
const AVAILABILITY = BASE + ROUTES.CHECK_CATEGORY_AVAILABILITY;
const GENERATE = BASE + ROUTES.GENERATE_CATEGORY_CODE;
const PRODUCT_REPORT = BASE + ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_CATEGORY;
const INVENTORY_REPORT = BASE + ROUTES.GENERATE_INVENTORY_REPORT_BY_CATEGORY;

before(h.start);
after(h.stop);

const seed_category = (name, code, status = "Active") => {
    const oid = uuidv4();
    return h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, $2, $3, $4)", [oid, name, code, status]).then(() => oid);
};

// A batch of stock is only reachable through the chain the real app builds it with: a supplier
// and a warehouse, a purchase and its line, then the inventory row. Seeding it properly is what
// makes the sellable assertions below exercise the actual query rather than a simplified one.
const seed_stock = async (category_oid, { quantity, cost, price, threshold, status = "ready_for_sale" }) => {
    const sub_oid = uuidv4();
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, $2, $3, $4, 'Active')", [sub_oid, `Group ${sub_oid.slice(0, 6)}`, `SUB-${sub_oid.slice(0, 6)}`, category_oid]);

    const product_oid = uuidv4();
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, status, restock_threshold) VALUES ($1, 'Cotton saree', $2, $3, 'Active', $4)", [product_oid, category_oid, sub_oid, threshold]);

    const supplier_oid = uuidv4();
    await h.query("INSERT INTO supplier (oid, name, phone_number, email, status) VALUES ($1, 'Mill', '01700000000', $2, 'Active')", [supplier_oid, `${supplier_oid.slice(0, 6)}@mill.test`]);

    const warehouse_oid = uuidv4();
    await h.query("INSERT INTO warehouse (oid, name, code, status) VALUES ($1, 'Main', $2, 'Active')", [warehouse_oid, `WH-${warehouse_oid.slice(0, 6)}`]);

    const purchase_oid = uuidv4();
    await h.query("INSERT INTO purchase (oid, supplier_oid, total_amount, paid_amount, status) VALUES ($1, $2, 0, 0, 'Received')", [purchase_oid, supplier_oid]);

    const purchase_details_oid = uuidv4();
    await h.query("INSERT INTO purchase_details (oid, purchase_oid, product_oid, warehouse_oid, ordered_quantity, ordered_unit_price) VALUES ($1, $2, $3, $4, $5, $6)", [purchase_details_oid, purchase_oid, product_oid, warehouse_oid, quantity, cost]);

    const inventory_oid = uuidv4();
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, purchase_details_oid, initial_quantity, quantity_available, cost_price, selling_price, status) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)", [inventory_oid, `B-${inventory_oid.slice(0, 6)}`, product_oid, purchase_details_oid, quantity, cost, price, status]);

    return { product_oid, inventory_oid };
};

// A hold belongs to an online order that has not been dispatched, which is the only thing that
// creates one.
const hold_stock = async (inventory_oid, quantity) => {
    const order_oid = uuidv4();
    await h.query("INSERT INTO orders (oid, invoice_no, total_amount, channel, status, order_type) VALUES ($1, $2, 0, 'ONLINE', 'Confirmed', 'Standard')", [order_oid, `INV-${order_oid.slice(0, 8)}`]);
    await h.query("INSERT INTO stock_hold (oid, order_oid, product_oid, inventory_oid, quantity, status) VALUES ($1, $2, (SELECT product_oid FROM inventory WHERE oid = $3), $3, $4, 'Active')", [uuidv4(), order_oid, inventory_oid, quantity]);
};

const create = (token, body) => h.call(CREATE, { method: "POST", token, body });
const update = (token, body) => h.call(UPDATE, { method: "POST", token, body });
const availability = (token, params) => h.call(`${AVAILABILITY}?${new URLSearchParams(params)}`, { method: "GET", token });
const generate = (token, params) => h.call(`${GENERATE}?${new URLSearchParams(params)}`, { method: "GET", token });

const A_CATEGORY = { name: "Saree", category_code: "SARE", description: "Everyday and festive", status: "Active" };

describe("creating and editing a category", () => {
    let author;

    beforeEach(async () => {
        await h.reset();
        const user = await h.seed_user({ permissions: ["configuration.category.view", "configuration.category.create", "configuration.category.edit"] });
        author = (await h.sign_in(user)).access;
    });

    it("creates a category and hands back the oid the form needs to open it", async () => {
        const res = await create(author, A_CATEGORY);

        assert.equal(res.status, 200);
        assert.equal(res.body.code, 200);
        assert.ok(res.body.data.oid, "the new category's oid comes back");

        const rows = await h.query("SELECT name, category_code, status, created_by FROM categories WHERE oid = $1", [res.body.data.oid]);
        assert.equal(rows[0].name, "Saree");
        assert.equal(rows[0].category_code, "SARE");
    });

    it("records the activity with the request that caused it, by the time the response arrives", async () => {
        const res = await create(author, A_CATEGORY);

        const rows = await h.query("SELECT title, request_id FROM activity_log WHERE reference_oid = $1", [res.body.data.oid]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].title, "Created category");
        assert.equal(rows[0].request_id, res.request_id);
    });

    it("joins each create and edit to its request: one request log row and one activity row, same id", async () => {
        const created = await create(author, A_CATEGORY);
        const edited = await h.call(UPDATE, { token: author, body: { oid: created.body.data.oid, ...A_CATEGORY, status: "Inactive" } });
        assert.equal(edited.status, 200);

        for (const [res, title] of [[created, "Created category"], [edited, "Updated category"]]) {
            const [request] = await h.query("SELECT route, status, request_body FROM api_request_log WHERE oid = $1", [res.request_id]);
            const activity = await h.query("SELECT title FROM activity_log WHERE request_id = $1", [res.request_id]);
            assert.equal(request.status, 200);
            assert.equal(request.request_body.name, "Saree");
            assert.deepEqual(activity.map((row) => row.title), [title]);
        }
    });

    it("leaves no activity for a change the database refused", async () => {
        await create(author, A_CATEGORY);

        const res = await create(author, { ...A_CATEGORY, category_code: "OTHER" });

        assert.equal(res.status, 409);
        const rows = await h.query("SELECT count(*)::int AS total FROM activity_log WHERE request_id = $1", [res.request_id]);
        assert.equal(rows[0].total, 0);
    });

    it("refuses a second category with the same name, whatever its capitals and spacing", async () => {
        await create(author, A_CATEGORY);

        const res = await create(author, { ...A_CATEGORY, name: "  saree ", category_code: "OTHER" });

        assert.equal(res.status, 409);
        assert.equal(res.body.data.field, "name", "the form is told which field to mark");
        const rows = await h.query("SELECT count(*)::int AS total FROM categories");
        assert.equal(rows[0].total, 1, "nothing was written");
    });

    it("refuses a second category with the same code, whatever its capitals", async () => {
        await create(author, A_CATEGORY);

        const res = await create(author, { ...A_CATEGORY, name: "Something else", category_code: "sare" });

        assert.equal(res.status, 409);
        assert.equal(res.body.data.field, "category_code");
    });

    // The old controller counted matching rows and then inserted. Two people adding the same
    // category at the same moment both read zero and both wrote. The unique index is what decides
    // now, so exactly one of these can win.
    it("lets only one of two simultaneous creates of the same name through", async () => {
        const [first, second] = await Promise.all([
            create(author, A_CATEGORY),
            create(author, { ...A_CATEGORY, category_code: "SARI" }),
        ]);

        const statuses = [first.status, second.status].sort();
        assert.deepEqual(statuses, [200, 409]);

        const rows = await h.query("SELECT count(*)::int AS total FROM categories");
        assert.equal(rows[0].total, 1);
    });

    it("refuses renaming a category onto a name another category already holds", async () => {
        await seed_category("Saree", "SARE");
        const kurti = await seed_category("Kurti", "KURT");

        const res = await update(author, { oid: kurti, name: "Saree", category_code: "KURT", description: null, status: "Active" });

        assert.equal(res.status, 409);
        assert.equal(res.body.data.field, "name");
    });

    it("lets a category keep its own name while something else about it changes", async () => {
        const saree = await seed_category("Saree", "SARE");

        const res = await update(author, { oid: saree, name: "Saree", category_code: "SARE", description: "Now described", status: "Inactive" });

        assert.equal(res.status, 200);
        const rows = await h.query("SELECT status, description FROM categories WHERE oid = $1", [saree]);
        assert.equal(rows[0].status, "Inactive");
    });

    it("answers 404 when the category being edited is gone, rather than reporting success", async () => {
        const res = await update(author, { oid: uuidv4(), name: "Ghost", category_code: "GHOS", description: null, status: "Active" });

        assert.equal(res.status, 404);
    });

    it("refuses a status the database would reject, as a 400 naming the field", async () => {
        const res = await create(author, { ...A_CATEGORY, status: "Archived" });

        assert.equal(res.status, 400);
    });

    it("stores the name trimmed, because the schema says trim and the schema has to mean it", async () => {
        const res = await create(author, { ...A_CATEGORY, name: "  Saree  ", category_code: "  sare  " });

        assert.equal(res.status, 200);
        const rows = await h.query("SELECT name, category_code FROM categories WHERE oid = $1", [res.body.data.oid]);
        assert.equal(rows[0].name, "Saree");
    });

    // The unique index compares upper(btrim(category_code)), so a lower case code is the same code
    // to the database and a different one to every screen that prints it. The web form capitalises
    // before it sends; a request written by hand is what this is for.
    it("stores a code in capitals however it was sent", async () => {
        const res = await create(author, { ...A_CATEGORY, category_code: "  sare  " });

        assert.equal(res.status, 200);
        const rows = await h.query("SELECT category_code FROM categories WHERE oid = $1", [res.body.data.oid]);
        assert.equal(rows[0].category_code, "SARE");
    });

    it("stores an empty description as nothing at all, not as an empty string", async () => {
        const res = await create(author, { ...A_CATEGORY, description: "" });

        assert.equal(res.status, 200);
        const rows = await h.query("SELECT description FROM categories WHERE oid = $1", [res.body.data.oid]);
        assert.equal(rows[0].description, null);
    });

    // It used to answer 404 "that category no longer exists", sending someone to look for a
    // category that is sitting there, when what was wrong was the request.
    it("refuses an update with no oid as a 400, not as a missing category", async () => {
        const res = await update(author, { name: "Saree", category_code: "SARE", description: null, status: "Active" });

        assert.equal(res.status, 400);
    });

    // Joi measures max(255) against the trimmed value. While the validator discarded that value,
    // a 255 character name with padding passed the schema at 265 characters and then hit
    // varchar(255), which answered 500. Now the trimmed value is what gets stored, so it fits.
    it("saves a padded name that is only over-long before trimming", async () => {
        const name = "x".repeat(255);
        const res = await create(author, { ...A_CATEGORY, name: `   ${name}   ` });

        assert.equal(res.status, 200, JSON.stringify(res.body));
        const rows = await h.query("SELECT name FROM categories WHERE oid = $1", [res.body.data.oid]);
        assert.equal(rows[0].name.length, 255);
    });

    it("still refuses a name that is over-long once trimmed, as a 400", async () => {
        const res = await create(author, { ...A_CATEGORY, name: "x".repeat(256) });

        assert.equal(res.status, 400);
    });

    it("records who created the category in the activity log", async () => {
        const res = await create(author, A_CATEGORY);

        // The activity log is written fire and forget, so it lands just after the response.
        const rows = await h.eventually(
            () => h.query("SELECT reference_type, title, performed_by FROM activity_log WHERE reference_oid = $1", [res.body.data.oid]),
            (found) => found.length > 0,
        );
        assert.equal(rows[0].reference_type, "category");
        assert.equal(rows[0].title, "Created category");
    });
});

describe("the numbers on a category's page", () => {
    let viewer;
    let saree;

    beforeEach(async () => {
        await h.reset();
        const user = await h.seed_user({ permissions: ["configuration.category.view"] });
        viewer = (await h.sign_in(user)).access;
        saree = await seed_category("Saree", "SARE");
    });

    const details = (token, oid) => h.call(`${BASE}${ROUTES.GET_CATEGORY_DETAILS}/${oid}`, { method: "GET", token });

    // CLAUDE.md section 1: sellable is quantity_available minus the Active holds. Counting held
    // units told the owner there were 12 to sell when 8 were already promised to online orders,
    // and "low on stock" stayed at nothing so nobody reordered.
    it("counts units a customer could actually buy, not units already promised", async () => {
        const { inventory_oid } = await seed_stock(saree, { quantity: 12, cost: 60, price: 100, threshold: 10 });
        await hold_stock(inventory_oid, 8);

        const res = await details(viewer, saree);

        assert.equal(res.status, 200);
        assert.equal(res.body.data.stats.totalAvailableQuantity, 4, "12 on hand minus 8 held");
        assert.equal(res.body.data.stats.lowStockItems, 1, "4 is at or under the threshold of 10");
    });

    // Spend is what the stock physically there cost, at cost_price and not at what it sells for.
    // A hold is a promise, not a purchase, so promising units to an order must not change it.
    it("reports what the stock in hand cost, and a hold does not change it", async () => {
        const { inventory_oid } = await seed_stock(saree, { quantity: 12, cost: 60, price: 100, threshold: 0 });

        const before = (await details(viewer, saree)).body.data.stats;
        assert.equal(Number(before.amountSpent), 720, "12 units at the 60 they cost, not at what they sell for");

        await hold_stock(inventory_oid, 8);
        const after = (await details(viewer, saree)).body.data.stats;

        assert.equal(after.totalAvailableQuantity, 4, "only 4 are still sellable");
        assert.equal(Number(after.amountSpent), 720, "but nothing was bought or sold, so the spend is unmoved");
    });

    // The same product is bought again at a different price, which is the normal case.
    it("costs each batch at the price that batch was bought at", async () => {
        await seed_stock(saree, { quantity: 10, cost: 50, price: 100, threshold: 0 });
        await seed_stock(saree, { quantity: 10, cost: 80, price: 100, threshold: 0 });

        const stats = (await details(viewer, saree)).body.data.stats;

        assert.equal(Number(stats.amountSpent), 1300, "10 at 50 plus 10 at 80, not 20 at either");
    });

    // Not everything a business holds is for sale. Packaging, delivery materials and office
    // supplies are bought, stored and run out like anything else, and their batches carry no
    // selling price. Admitting only the for-sale statuses made a Packaging category read empty.
    it("counts stock that is not for sale, and what was spent on it", async () => {
        const packaging = await seed_category("Packaging", "PACK");
        await seed_stock(packaging, { quantity: 40, cost: 12, price: null, threshold: 0, status: "internal_use" });

        const stats = (await details(viewer, packaging)).body.data.stats;

        assert.equal(stats.totalAvailableQuantity, 40, "the bags are there whether or not they are sold");
        assert.equal(Number(stats.amountSpent), 480, "40 bags at 12");
    });

    // A disposal is approved against quantity_available alone and does not release the holds it
    // invalidates, so on hand can end up below what is held. Unclamped, that batch carried a
    // negative into the category total and ate another product's real stock, and the oversold
    // product matched neither the low arm nor the out arm, so no card named it.
    it("never lets an oversold batch subtract from the rest of the category", async () => {
        const { inventory_oid } = await seed_stock(saree, { quantity: 10, cost: 100, price: 150, threshold: 0 });
        await hold_stock(inventory_oid, 10);
        await h.query("UPDATE inventory SET quantity_available = 0 WHERE oid = $1", [inventory_oid]);
        await seed_stock(saree, { quantity: 30, cost: 100, price: 150, threshold: 0 });

        const stats = (await details(viewer, saree)).body.data.stats;

        assert.equal(stats.totalAvailableQuantity, 30, "the other product's 30 units, undamaged by the oversold one");
        assert.equal(stats.outOfStockItems, 1, "the product that cannot be fulfilled is named");
    });

    // It was an unweighted average of per-product averages, so a one unit batch counted as much as
    // a five hundred unit one and the answer was an average of nothing a customer pays.
    it("averages the selling price over the units, not over the batches", async () => {
        await seed_stock(saree, { quantity: 90, cost: 40, price: 100, threshold: 0 });
        await seed_stock(saree, { quantity: 10, cost: 40, price: 200, threshold: 0 });

        const stats = (await details(viewer, saree)).body.data.stats;

        assert.equal(Number(stats.averageProductPrice), 110, "90 at 100 and 10 at 200 is 110, not the 150 the batches average to");
    });

    it("leaves an unpriced batch out of the average rather than counting it as free", async () => {
        await seed_stock(saree, { quantity: 10, cost: 40, price: 100, threshold: 0 });
        await seed_stock(saree, { quantity: 40, cost: 12, price: null, threshold: 0, status: "internal_use" });

        const stats = (await details(viewer, saree)).body.data.stats;

        assert.equal(Number(stats.averageProductPrice), 100, "the packaging has no selling price, so it is not part of one");
    });

    it("carries the activity's own id, so two entries in one millisecond do not collide", async () => {
        const author = await h.seed_user({ email: "author@samiha.test", permissions: ["configuration.category.view", "configuration.category.edit"] });
        const token = (await h.sign_in(author)).access;
        await update(token, { oid: saree, name: "Saree", category_code: "SARE", description: "Now described", status: "Active" });

        const activity = await h.eventually(
            () => details(viewer, saree).then((res) => res.body.data.activity),
            (found) => found.length > 0,
        );

        assert.ok(activity[0].oid, "the timeline is keyed on this");
    });

    it("carries the last action, so the page can say when it was last touched", async () => {
        const res = await details(viewer, saree);

        assert.ok(res.body.data.details.last_action_on, "the detail page renders this");
        assert.ok(res.body.data.details.last_action_by);
    });
});

// Reading a category and taking its whole product catalogue out of the building are different acts,
// so the export permission is its own and the page hides the buttons with the same code.
describe("downloading a category's reports", () => {
    let saree;

    beforeEach(async () => {
        await h.reset();
        saree = await seed_category("Saree", "SARE");
    });

    const as = async (permissions) => {
        const user = await h.seed_user({ permissions });
        return (await h.sign_in(user)).access;
    };

    for (const [name, route] of [
        ["the product list", PRODUCT_REPORT],
        ["the inventory report", INVENTORY_REPORT],
    ]) {
        it(`refuses ${name} to someone who may view the category but not export it`, async () => {
            const viewer = await as(["configuration.category.view"]);

            const res = await h.call(route, { method: "POST", token: viewer, body: { oid: saree } });

            assert.equal(res.status, 403, "view alone does not carry a catalogue out of the building");
        });

        it(`refuses ${name} to someone signed out`, async () => {
            const res = await h.call(route, { method: "POST", body: { oid: saree } });

            assert.equal(res.status, 401);
        });
    }
});

describe("checking whether a category name or code is free", () => {
    let viewer;
    let saree;

    beforeEach(async () => {
        await h.reset();
        const user = await h.seed_user({ permissions: ["configuration.category.view"] });
        viewer = (await h.sign_in(user)).access;
        saree = await seed_category("Saree", "SARE");
    });

    it("refuses someone without the view permission", async () => {
        await h.query("TRUNCATE login, role, role_permission CASCADE");
        const other = await h.seed_user({ email: "counter@samiha.test", permissions: ["dashboard.overview.view"] });
        const { access } = await h.sign_in(other);

        assert.equal((await availability(access, { field: "name", value: "Kurti" })).status, 403);
        assert.equal((await generate(access, { name: "Kurti" })).status, 403);
    });

    it("says a new name is free and a taken one is not, ignoring capitals and spacing", async () => {
        assert.equal((await availability(viewer, { field: "name", value: "Kurti" })).body.data.available, true);
        assert.equal((await availability(viewer, { field: "name", value: "  saree " })).body.data.available, false);
    });

    it("does not report a category's own name as taken while it is being edited", async () => {
        assert.equal((await availability(viewer, { field: "name", value: "Saree" })).body.data.available, false);
        assert.equal((await availability(viewer, { field: "name", value: "Saree", oid: saree })).body.data.available, true);
    });

    it("checks the code the same way", async () => {
        assert.equal((await availability(viewer, { field: "category_code", value: "sare" })).body.data.available, false);
        assert.equal((await availability(viewer, { field: "category_code", value: "KURT" })).body.data.available, true);
    });

    it("refuses a field that is not one of the two it checks", async () => {
        assert.equal((await availability(viewer, { field: "status", value: "Active" })).status, 400);
    });
});

describe("generating a category code", () => {
    let viewer;

    beforeEach(async () => {
        await h.reset();
        const user = await h.seed_user({ permissions: ["configuration.category.view"] });
        viewer = (await h.sign_in(user)).access;
    });

    it("builds a code from the name, in capitals and letters only", async () => {
        const res = await generate(viewer, { name: "Traditional Clothing" });

        assert.equal(res.status, 200);
        assert.equal(res.body.data.category_code, "TRADCLO");
    });

    it("transliterates a Bengali name rather than giving up on it", async () => {
        assert.equal((await generate(viewer, { name: "শাড়ি" })).body.data.category_code, "SHAR");
        assert.equal((await generate(viewer, { name: "থ্রি পিস" })).body.data.category_code, "THRIPIS");
    });

    it("extends the code with another letter of the name rather than numbering it", async () => {
        await seed_category("Footwear", "FOOT");

        const res = await generate(viewer, { name: "Football" });

        assert.equal(res.body.data.category_code, "FOOTB");
        assert.match(res.body.data.category_code, /^[A-Z]+$/, "a code carries no digits");
    });

    it("never suggests a code another category already holds", async () => {
        for (const candidate of buildCandidates("Saree").slice(0, 5)) await seed_category(`Holder ${candidate}`, candidate);

        const res = await generate(viewer, { name: "Saree" });

        assert.equal(res.status, 200);
        const rows = await h.query("SELECT count(*)::int AS total FROM categories WHERE upper(btrim(category_code)) = $1", [res.body.data.category_code]);
        assert.equal(rows[0].total, 0);
    });

    it("does not count the category being edited as holding its own code", async () => {
        const electronics = await seed_category("Electronics", "ELEC");

        const without = await generate(viewer, { name: "Electronics" });
        const editing = await generate(viewer, { name: "Electronics", oid: electronics });

        assert.equal(without.body.data.category_code, "ELECT", "another category holds ELEC");
        assert.equal(editing.body.data.category_code, "ELEC", "its own code is still its own");
    });

    it("says so plainly when a name has no letters to build a code from", async () => {
        const res = await generate(viewer, { name: "###" });

        assert.equal(res.status, 400);
        assert.match(res.body.message, /type a code yourself/i);
    });
});
