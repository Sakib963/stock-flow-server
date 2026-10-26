const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const ExcelJS = require("exceljs");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

before(h.start);
after(h.stop);

// The same shelf, downloaded from each record that groups it: 12 kurtis with 8 promised to an online
// order, 40 bags of packaging nobody sells, and a deleted product. Every export must read 4 sellable
// and 6,800 spent, as the record pages do, and carry no sale value or profit line.
const seed = async () => {
    const ids = { category: uuidv4(), sub_category: uuidv4(), brand: uuidv4(), warehouse: uuidv4(), aisle: uuidv4() };
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [ids.category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Tops', 'TOPS', $2, 'Active')", [ids.sub_category, ids.category]);
    await h.query("INSERT INTO brands (oid, name, status) VALUES ($1, 'House brand', 'Active')", [ids.brand]);
    await h.query("INSERT INTO warehouse (oid, name, code, status) VALUES ($1, 'Main', 'MAIN', 'Active')", [ids.warehouse]);
    await h.query("INSERT INTO aisle (oid, name, code, warehouse_oid, status) VALUES ($1, 'Shelf A', 'SHA', $2, 'Active')", [ids.aisle, ids.warehouse]);

    const batch = async (name, { quantity, cost, price, use = "for_sale", deleted = false }) => {
        const product = uuidv4();
        const oid = uuidv4();
        await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, brand_oid, restock_threshold, status, is_deleted) VALUES ($1, $2, $3, $4, $5, $6, 0, 'Active', $7)", [product, name, name.toUpperCase().replace(/\W/g, ""), ids.category, ids.sub_category, ids.brand, deleted]);
        await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, selling_price, intended_use, status, warehouse_oid, aisle_oid) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, $10)", [oid, `B-${oid.slice(0, 4)}-${oid.slice(4, 8)}`.toUpperCase(), product, quantity, cost, price, use, use === "for_sale" ? "ready_for_sale" : "internal_use", ids.warehouse, ids.aisle]);
        return oid;
    };
    const kurtis = await batch("Cotton kurti", { quantity: 12, cost: 500, price: 800 });
    await batch("Shopping bag", { quantity: 40, cost: 20, price: null, use: "internal_use" });
    await batch("Old scarf", { quantity: 5, cost: 100, price: 200, deleted: true });

    const order = uuidv4();
    await h.query("INSERT INTO orders (oid, invoice_no, total_amount, channel, status, order_type) VALUES ($1, 'INV-HOLD', 0, 'ONLINE', 'Confirmed', 'Standard')", [order]);
    await h.query("INSERT INTO stock_hold (oid, order_oid, product_oid, inventory_oid, quantity, status) VALUES ($1, $2, (SELECT product_oid FROM inventory WHERE oid = $3), $3, 8, 'Active')", [uuidv4(), order, kurtis]);
    return ids;
};

const GROUPS = [
    ["a category", "category", SUB_CONTEXTS.CATEGORY, "CATEGORY", "configuration.category.export"],
    ["a sub-category", "sub_category", SUB_CONTEXTS.SUB_CATEGORY, "SUB_CATEGORY", "configuration.sub-category.export"],
    ["a brand", "brand", SUB_CONTEXTS.BRANDS, "BRAND", "configuration.brands.export"],
    ["a warehouse", "warehouse", SUB_CONTEXTS.WAREHOUSE, "WAREHOUSE", "configuration.warehouse.export"],
    ["an aisle", "aisle", SUB_CONTEXTS.AISLE, "AISLE", "configuration.aisle.export"],
];

const download = async (route, token, oid) => {
    const res = await fetch(`${h.url()}${route}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ oid }) });
    assert.equal(res.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
    const rows = [];
    workbook.worksheets[0].eachRow((row) => rows.push(row.values.slice(1).map((value) => String(value ?? ""))));
    return { rows, line: (label) => rows.find((row) => row[0] === label)?.filter(Boolean).at(-1) };
};

describe("the stock exports of every record that groups products", () => {
    let ids;

    beforeEach(async () => {
        await h.reset();
        await h.query("TRUNCATE stock_hold, inventory, orders, product, sub_categories, categories, brands, aisle, warehouse CASCADE");
        ids = await seed();
    });

    for (const [name, key, context, suffix, permission] of GROUPS) {
        it(`reads what can be sold and what the stock cost from ${name}, without the deleted product or a sale value`, async () => {
            const token = (await h.sign_in(await h.seed_user({ email: `export-${uuidv4().slice(0, 8)}@arithmalabs.test`, permissions: [permission] }))).access;
            const base = CONTEXTS.CONFIGURATION + context;

            const products = await download(base + ROUTES[`GENERATE_PRODUCT_LIST_REPORT_BY_${suffix}`], token, ids[key]);
            assert.equal(products.line("Total Products:"), "2");
            assert.equal(products.line("Total Sellable Quantity:"), "4");
            assert.equal(Number(products.line("Stock Value at Cost:")), 6800);

            const inventory = await download(base + ROUTES[`GENERATE_INVENTORY_REPORT_BY_${suffix}`], token, ids[key]);
            const header = inventory.rows.find((row) => row[0] === "Product Name");
            const batches = inventory.rows.filter((row) => row[header.indexOf("Batch Code")]?.startsWith("B-"));
            assert.equal(batches.length, 2);
            assert.equal(batches.reduce((sum, row) => sum + Number(row[header.indexOf("Sellable")]), 0), 4);
            assert.equal(Number(inventory.line("Stock Value at Cost:")), 6800);

            for (const { rows } of [products, inventory]) assert.ok(!rows.flat().some((cell) => /Potential Profit|Selling Price\)/.test(cell)));
        });
    }
});
