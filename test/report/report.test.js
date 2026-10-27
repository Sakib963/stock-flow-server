const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const SALES = CONTEXTS.REPORT + SUB_CONTEXTS.SALES_REPORT;
const STOCK = CONTEXTS.REPORT + SUB_CONTEXTS.STOCK_REPORT;
const SELLS = ["sales.pos.view", "sales.online.view"];
const MONEY = "inventory.stock-value.view";

before(h.start);
after(h.stop);

let seq = 0;
const person = async (permissions) => (await h.sign_in(await h.seed_user({ email: `reporter${++seq}@arithmalabs.test`, permissions }))).access;

const sales_report = (token, report, query = "date_from=2026-10-01&date_to=2026-10-31") => h.call(`${SALES}${ROUTES.GET_SALES_REPORT}?report=${report}&${query}`, { method: "GET", token });
const stock_report = (token, report, query = "") => h.call(`${STOCK}${ROUTES.GET_STOCK_REPORT}?report=${report}&${query}`, { method: "GET", token });

// Midday in Dhaka, so the business day is the date written whatever the machine's clock.
const at = (day) => `${day} 06:00:00`;

const seed_catalogue = async () => {
    await h.query("TRUNCATE stock_movement, stock_hold, return_details, product_return, online_order, order_items, orders, dispose_details, product_dispose, stock_adjustment_line, stock_adjustment, purchase_details, purchase, giveaway, inventory, product, sub_categories CASCADE");
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ('C-1', 'Kurti', 'KUR', 'Active')");
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ('S-1', 'Printed', 'PRI', 'C-1', 'Active')");
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold) VALUES ('P-1', 'Floral Kurti', 'FK-1', 'C-1', 'S-1', 5), ('P-2', 'Gift Box', 'GB-1', 'C-1', 'S-1', 10), ('P-3', 'Plain Kurti', 'PK-1', 'C-1', 'S-1', 3)");
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, selling_price, status) VALUES ('I-1', 'B-1', 'P-1', 50, 3, 300, 500, 'ready_for_sale'), ('I-2', 'B-2', 'P-2', 40, 40, 20, NULL, 'internal_use')");
};

const order = async ({ channel = "POS", status = "Purchased", sold_on = at("2026-10-05"), payment_status = "paid", total_amount = 0, amount_paid = payment_status === "paid" ? total_amount : 0, delivery_charge = 0, refund_due = 0, amount_refunded = 0, payment_type = null, lines }) => {
    const oid = uuidv4();
    await h.query(
        "INSERT INTO orders (oid, invoice_no, total_amount, channel, status, sold_on, payment_status, amount_paid, delivery_charge, refund_due, amount_refunded, payment_type, customer_name) VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Rina')",
        [oid, total_amount, channel, status, sold_on, payment_status, amount_paid, delivery_charge, refund_due, amount_refunded, payment_type]
    );
    for (const line of lines) {
        await h.query("INSERT INTO order_items (oid, order_oid, inventory_oid, product_oid, product_name, quantity, unit_price, discount, total, returned_qty) VALUES ($1, $2, 'I-1', 'P-1', 'Floral Kurti', $3, $4, $5, 0, $6)", [uuidv4(), oid, line.quantity, line.unit_price, line.discount ?? 0, line.returned ?? 0]);
    }
    return oid;
};

describe("report access", () => {
    beforeEach(async () => {
        await h.reset();
        await seed_catalogue();
    });

    it("refuses sales reports to someone without the sales report permission", async () => {
        const res = await sales_report(await person([...SELLS, "report.stock.view"]), "sales-register");
        assert.equal(res.status, 403);
    });

    it("refuses a download to someone who may only look", async () => {
        const token = await person([...SELLS, "report.sales.view"]);
        const res = await h.call(`${SALES}${ROUTES.DOWNLOAD_SALES_REPORT}?report=daily-sales`, { method: "GET", token });
        assert.equal(res.status, 403);
    });

    it("refuses a report that does not exist and a period longer than a year", async () => {
        const token = await person([...SELLS, "report.sales.view"]);
        assert.equal((await sales_report(token, "everything")).status, 400);
        assert.equal((await sales_report(token, "daily-sales", "date_from=2025-01-01&date_to=2026-10-31")).status, 400);
        assert.equal((await sales_report(token, "daily-sales", "date_from=2024-01-01")).status, 400);
    });

    it("refuses supplier dues to someone who may not see buying prices", async () => {
        const res = await stock_report(await person(["report.stock.view"]), "supplier-dues");
        assert.equal(res.status, 403);
    });
});

describe("sales register", () => {
    beforeEach(async () => {
        await h.reset();
        await seed_catalogue();
    });

    it("counts kept units at the line price less the per-unit discount, with cost only for stock value access", async () => {
        await order({ total_amount: 1800, lines: [{ quantity: 4, unit_price: 500, discount: 50, returned: 1 }] });
        await order({ status: "Confirmed", sold_on: null, payment_status: "unpaid", lines: [{ quantity: 9, unit_price: 500 }] });

        const owner = await sales_report(await person([...SELLS, "report.sales.view", MONEY]), "sales-register");
        assert.equal(owner.status, 200);
        assert.equal(owner.body.data.rows.length, 1);
        const row = owner.body.data.rows[0];
        assert.deepEqual([row.goods, row.discount, row.returns, row.sales, row.cost, row.profit], [2000, 200, 450, 1350, 900, 450]);

        const cashier = await sales_report(await person([...SELLS, "report.sales.view"]), "sales-register");
        assert.equal(cashier.body.data.columns.some((c) => c.key === "cost" || c.key === "profit"), false);
        assert.equal("cost" in cashier.body.data.rows[0], false);
        assert.equal("cost" in cashier.body.data.totals, false);
    });

    it("keeps a fully returned order in the register with nothing sold but the delivery charge and money it kept", async () => {
        await order({ channel: "ONLINE", status: "Returned", total_amount: 1100, delivery_charge: 100, refund_due: 1000, payment_type: "PREPAID", lines: [{ quantity: 2, unit_price: 500, returned: 2 }] });

        const res = await sales_report(await person([...SELLS, "report.sales.view"]), "sales-register");
        const row = res.body.data.rows[0];
        assert.deepEqual([row.sales, row.returns, row.delivery, row.received, row.owed], [0, 1000, 100, 100, 0]);
        assert.equal(res.body.data.totals.sales_count, 0);
    });

    it("gives the delivery charge nothing when a return gave it back", async () => {
        const oid = await order({ channel: "ONLINE", status: "Returned", delivery_charge: 100, payment_status: "unpaid", lines: [{ quantity: 1, unit_price: 500, returned: 1 }] });
        await h.query("INSERT INTO product_return (oid, order_oid, invoice_no, refund_amount, return_reason, status, refund_delivery_charge) VALUES ('R-1', $1, 'R-1', 0, 'changed_mind', 'Returned', true)", [oid]);

        const res = await sales_report(await person([...SELLS, "report.sales.view"]), "sales-register");
        assert.equal(res.body.data.rows[0].delivery, 0);
        assert.equal(res.body.data.rows[0].owed, 0);
    });

    it("shows only the channels the person sells through", async () => {
        await order({ lines: [{ quantity: 1, unit_price: 500 }] });
        await order({ channel: "ONLINE", status: "Delivered", lines: [{ quantity: 1, unit_price: 700 }] });

        const res = await sales_report(await person(["sales.pos.view", "report.sales.view"]), "sales-register");
        assert.deepEqual(res.body.data.rows.map((r) => r.channel), ["POS"]);
    });
});

describe("customer dues and returns", () => {
    beforeEach(async () => {
        await h.reset();
        await seed_catalogue();
    });

    it("lists what is still owed on sales, never a paid order, a cancelled one or an order that is not a sale", async () => {
        await order({ payment_status: "partially_paid", amount_paid: 300, delivery_charge: 100, lines: [{ quantity: 2, unit_price: 500 }] });
        await order({ payment_status: "paid", total_amount: 500, lines: [{ quantity: 1, unit_price: 500 }] });
        await order({ status: "Confirmed", sold_on: null, payment_status: "unpaid", lines: [{ quantity: 1, unit_price: 500 }] });

        const res = await sales_report(await person([...SELLS, "report.sales.view"]), "customer-dues", "");
        assert.equal(res.body.data.rows.length, 1);
        assert.deepEqual([res.body.data.rows[0].customer_total, res.body.data.rows[0].received, res.body.data.rows[0].owed], [1100, 300, 800]);
        assert.equal(res.body.data.totals.owed, 800);
    });

    it("leaves a refused parcel out of returns, since it was never a sale", async () => {
        const sold = await order({ lines: [{ quantity: 2, unit_price: 500, returned: 1 }] });
        const refused = await order({ channel: "ONLINE", status: "Confirmed", sold_on: null, lines: [{ quantity: 1, unit_price: 500 }] });
        await h.query(
            "INSERT INTO product_return (oid, order_oid, invoice_no, refund_amount, return_reason, not_delivered_reason, status, edited_on) VALUES ('R-1', $1, 'R-1', 500, 'changed_mind', NULL, 'Returned', $3), ('R-2', $2, 'R-2', 0, 'not_delivered', 'refused', 'Returned', $3)",
            [sold, refused, at("2026-10-10")]
        );
        const [line] = await h.query("SELECT oid FROM order_items WHERE order_oid = $1", [sold]);
        await h.query("INSERT INTO return_details (oid, return_oid, product_oid, inventory_oid, return_quantity, order_item_oid, condition) VALUES ('RD-1', 'R-1', 'P-1', 'I-1', 1, $1, 'Good')", [line.oid]);

        const res = await sales_report(await person([...SELLS, "report.sales.view"]), "returns");
        assert.deepEqual(res.body.data.rows.map((r) => r.return_no), ["R-1"]);
        assert.equal(res.body.data.rows[0].value, 500);
    });
});

describe("stock reports", () => {
    beforeEach(async () => {
        await h.reset();
        await seed_catalogue();
    });

    it("shows sellable never below 0 and nothing sellable on internal use stock, with value only for stock value access", async () => {
        await order({ channel: "ONLINE", status: "Confirmed", sold_on: null, lines: [{ quantity: 5, unit_price: 500 }] });
        const [o] = await h.query("SELECT oid FROM orders LIMIT 1");
        await h.query("INSERT INTO stock_hold (oid, order_oid, product_oid, inventory_oid, quantity, status) VALUES ('H-1', $1, 'P-1', 'I-1', 5, 'Active')", [o.oid]);

        const owner = await stock_report(await person(["report.stock.view", MONEY]), "stock-on-hand");
        const by_batch = Object.fromEntries(owner.body.data.rows.map((r) => [r.batch, r]));
        assert.deepEqual([by_batch["B-1"].on_hand, by_batch["B-1"].held, by_batch["B-1"].sellable, by_batch["B-1"].value_at_cost], [3, 5, 0, 900]);
        assert.equal(by_batch["B-2"].sellable, 0);

        const keeper = await stock_report(await person(["report.stock.view"]), "stock-on-hand");
        assert.equal("value_at_cost" in keeper.body.data.rows[0], false);
    });

    it("reorders a product whose free stock is at its level or it has no batch, but not packaging still on the shelf for own use", async () => {
        const res = await stock_report(await person(["report.stock.view"]), "reorder-list");
        assert.deepEqual(res.body.data.rows.map((r) => r.product).sort(), ["Floral Kurti", "Plain Kurti"]);
    });

    it("reorders a product sold from an empty batch although some of it is kept for own use", async () => {
        await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, status) VALUES ('I-9', 'B-9', 'P-3', 0, 0, 100, 'ready_for_sale'), ('I-10', 'B-10', 'P-3', 20, 20, 100, 'internal_use')");
        const res = await stock_report(await person(["report.stock.view"]), "reorder-list");
        assert.equal(res.body.data.rows.find((r) => r.product === "Plain Kurti")?.in_stock, 0);
    });

    it("adds opening and every movement up to the closing, a returned gift netted into given away", async () => {
        await h.query("INSERT INTO giveaway (oid, giveaway_no, recipient_name, status) VALUES ('G-1', 'GV-1', 'Page', 'Returned')");
        await h.query(
            `INSERT INTO stock_movement (oid, inventory_oid, product_oid, quantity, balance_after, reason, source_oid, created_on) VALUES
             ('M-1', 'I-1', 'P-1', 10, 10, 'carried_over', NULL, $1),
             ('M-2', 'I-1', 'P-1', -4, 6, 'sold', NULL, $2),
             ('M-3', 'I-1', 'P-1', -2, 4, 'given_away', 'G-1', $2),
             ('M-4', 'I-1', 'P-1', 2, 6, 'returned', 'G-1', $2),
             ('M-5', 'I-1', 'P-1', 1, 7, 'returned', NULL, $2),
             ('M-6', 'I-1', 'P-1', -4, 3, 'adjusted', NULL, $2)`,
            [at("2026-10-01"), at("2026-10-15")]
        );

        const res = await stock_report(await person(["report.stock.view"]), "stock-movement-summary", "date_from=2026-10-01&date_to=2026-10-31");
        const row = res.body.data.rows[0];
        assert.deepEqual([row.opening, row.out_on_orders, row.given_away, row.returned, row.adjusted, row.closing], [10, -4, 0, 1, -4, 3]);
        assert.equal(row.opening + row.units_received + row.out_on_orders + row.returned + row.given_away + row.disposed + row.adjusted, row.closing);
    });

    it("costs an adjustment's out line at its batch, which the line itself does not carry", async () => {
        await h.query("INSERT INTO stock_adjustment (oid, adjustment_number, reason, status, verified_on) VALUES ('A-1', 'ADJ-1', 'lost', 'Verified', $1)", [at("2026-10-12")]);
        await h.query("INSERT INTO stock_adjustment_line (oid, adjustment_oid, product_oid, direction, quantity, inventory_oid) VALUES ('AL-1', 'A-1', 'P-1', 'out', 2, 'I-1')");

        const res = await stock_report(await person(["report.stock.view", MONEY]), "stock-adjustments", "date_from=2026-10-01&date_to=2026-10-31");
        assert.deepEqual([res.body.data.rows[0].units_out, res.body.data.rows[0].value_out], [2, 600]);
    });

    it("marks a disposal raised by a damaged return", async () => {
        await h.query("INSERT INTO product_dispose (oid, dispose_no, disposal_date, status, approved_on) VALUES ('D-1', 'DISP-R-1', '2026-10-12', 'Approved', $1)", [at("2026-10-12")]);
        await h.query("INSERT INTO dispose_details (oid, dispose_oid, product_oid, inventory_oid, dispose_quantity, reason, cost_price) VALUES ('DD-1', 'D-1', 'P-1', 'I-1', 1, 'damaged', 300)");
        await h.query("INSERT INTO orders (oid, invoice_no, total_amount) VALUES ('O-9', 'O-9', 0)");
        await h.query("INSERT INTO product_return (oid, order_oid, invoice_no, refund_amount, return_reason, status) VALUES ('R-9', 'O-9', 'R-9', 0, 'damaged_on_arrival', 'Returned')");
        await h.query("INSERT INTO return_details (oid, return_oid, product_oid, inventory_oid, return_quantity, condition, dispose_oid) VALUES ('RD-9', 'R-9', 'P-1', 'I-1', 1, 'Damaged', 'D-1')");

        const res = await stock_report(await person(["report.stock.view"]), "disposals", "date_from=2026-10-01&date_to=2026-10-31");
        assert.equal(res.body.data.rows[0].from_return, true);
    });

    it("downloads a sheet whose figures are numbers Excel can add up", async () => {
        const token = await person(["report.stock.view", "report.stock.export", MONEY]);
        const res = await fetch(`${h.url()}${STOCK}${ROUTES.DOWNLOAD_STOCK_REPORT}?report=stock-on-hand`, { headers: { authorization: `Bearer ${token}` } });
        assert.equal(res.status, 200);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
        const sheet = workbook.worksheets[0];
        let found = null;
        sheet.eachRow((row) => {
            if (row.getCell(6).value === "B-1") found = row;
        });
        assert.equal(typeof found.getCell(9).value, "number");
        assert.equal(found.getCell(8).value, "For sale");
    });
});

describe("round two reports", () => {
    beforeEach(async () => {
        await h.reset();
        await seed_catalogue();
    });

    it("sends one page of rows with totals over every row", async () => {
        for (let i = 0; i < 3; i++) await order({ lines: [{ quantity: 1, unit_price: 100 }] });
        const res = await sales_report(await person([...SELLS, "report.sales.view"]), "sales-register", "date_from=2026-10-01&date_to=2026-10-31&offset=1&limit=1");
        assert.equal(res.body.data.rows.length, 1);
        assert.equal(res.body.data.row_count, 3);
        assert.equal(res.body.data.totals.sales, 300);
    });

    it("lists a product with no restock level once it is out, and answers", async () => {
        await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid, restock_threshold) VALUES ('P-4', 'Silk Scarf', 'C-1', 'S-1', 0)");
        const res = await stock_report(await person(["report.stock.view"]), "reorder-list");
        assert.equal(res.status, 200);
        assert.equal(res.body.data.rows[0].product, "Silk Scarf");
    });

    it("collects from couriers exactly what customer dues says online customers owe, an advance's rest included", async () => {
        const advance = await order({ channel: "ONLINE", status: "Delivered", payment_status: "partially_paid", payment_type: "ADVANCE", amount_paid: 200, lines: [{ quantity: 3, unit_price: 500 }] });
        await h.query("INSERT INTO online_order (order_oid, courier) VALUES ($1, 'Pathao') ON CONFLICT (order_oid) DO UPDATE SET courier = 'Pathao'", [advance]);
        await order({ payment_status: "unpaid", lines: [{ quantity: 1, unit_price: 400 }] });
        const token = await person([...SELLS, "report.sales.view"]);
        const cod = await sales_report(token, "cod-with-couriers", "");
        const dues = await sales_report(token, "customer-dues", "channel=ONLINE");
        assert.equal(cod.body.data.totals.to_collect, 1300);
        assert.equal(cod.body.data.totals.to_collect, dues.body.data.totals.owed);
    });

    it("lists batches expiring within the chosen days, already expired ones first", async () => {
        await h.query("UPDATE inventory SET expiry_date = CURRENT_DATE - 3 WHERE oid = 'I-1'");
        await h.query("UPDATE inventory SET expiry_date = CURRENT_DATE + 120 WHERE oid = 'I-2'");
        const res = await stock_report(await person(["report.stock.view"]), "expiring-stock", "within_days=90");
        assert.deepEqual(res.body.data.rows.map((r) => r.batch), ["B-1"]);
        assert.ok(res.body.data.rows[0].days_left < 0);
        const wider = await stock_report(await person(["report.stock.view"]), "expiring-stock", "within_days=180");
        assert.deepEqual(wider.body.data.rows.map((r) => r.batch), ["B-1", "B-2"]);
    });

    it("adds categories up to what sales by product says, with margin from the sums", async () => {
        await order({ lines: [{ quantity: 2, unit_price: 500 }] });
        const token = await person([...SELLS, "report.sales.view", MONEY]);
        const cat = await sales_report(token, "profit-by-category");
        const prod = await sales_report(token, "sales-by-product");
        assert.equal(cat.body.data.totals.sales, prod.body.data.totals.sales);
        assert.equal(cat.body.data.totals.margin, 40);
    });
});

describe("customer and marketing reports", () => {
    const CUSTOMER = CONTEXTS.REPORT + SUB_CONTEXTS.CUSTOMER_REPORT + ROUTES.GET_CUSTOMER_REPORT;
    const MARKETING = CONTEXTS.REPORT + SUB_CONTEXTS.MARKETING_REPORT + ROUTES.GET_MARKETING_REPORT;
    const get = (token, url, report, query = "") => h.call(`${url}?report=${report}&${query}`, { method: "GET", token });

    beforeEach(async () => {
        await h.reset();
        await seed_catalogue();
        await h.query("TRUNCATE customers, partner_payment, campaign_partner, campaign, partner CASCADE");
        await h.query("INSERT INTO customers (oid, name, status) VALUES ('CU-1', 'Rina', 'Inactive'), ('CU-2', 'Mita', 'Active')");
    });

    it("lists an inactive customer who still owes, with what customer dues says", async () => {
        const oid = await order({ payment_status: "unpaid", lines: [{ quantity: 2, unit_price: 400 }] });
        await h.query("UPDATE orders SET customer_oid = 'CU-1' WHERE oid = $1", [oid]);
        const res = await get(await person([...SELLS, "report.customer.view"]), CUSTOMER, "customer-list");
        const rina = res.body.data.rows.find((r) => r.customer === "Rina");
        assert.deepEqual([rina.owed, rina.bought, rina.sales], [800, 800, 1]);
    });

    it("leaves out of gone quiet a customer whose new order is on its way", async () => {
        for (const cu of ["CU-1", "CU-2"]) {
            const oid = await order({ sold_on: "2026-01-05 06:00:00", lines: [{ quantity: 1, unit_price: 400 }] });
            await h.query("UPDATE orders SET customer_oid = $2 WHERE oid = $1", [oid, cu]);
        }
        const open = await order({ channel: "ONLINE", status: "Confirmed", sold_on: null, lines: [{ quantity: 1, unit_price: 400 }] });
        await h.query("UPDATE orders SET customer_oid = 'CU-2' WHERE oid = $1", [open]);
        const res = await get(await person([...SELLS, "report.customer.view"]), CUSTOMER, "customers-gone-quiet");
        assert.deepEqual(res.body.data.rows.map((r) => r.customer), ["Rina"]);
    });

    it("refuses customer reports to someone without them", async () => {
        const res = await get(await person([...SELLS, "report.sales.view"]), CUSTOMER, "customer-list");
        assert.equal(res.status, 403);
    });

    it("owes a partner nothing on a cancelled campaign, and needs the payments permission", async () => {
        await h.query("INSERT INTO partner (oid, name, partner_type, status) VALUES ('PA-1', 'Page One', 'Page', 'Active')");
        await h.query("INSERT INTO campaign (oid, campaign_no, name, promotion_type, status, posting_start, posting_end, measure_end) VALUES ('CA-1', 'CMP-1', 'Eid', 'InfluencerPost', 'Live', '2026-10-01', '2026-10-10', '2026-10-20'), ('CA-2', 'CMP-2', 'Winter', 'InfluencerPost', 'Cancelled', '2026-10-01', '2026-10-10', '2026-10-20')");
        await h.query("INSERT INTO campaign_partner (oid, campaign_oid, partner_oid, agreed_fee) VALUES ('CP-1', 'CA-1', 'PA-1', 5000), ('CP-2', 'CA-2', 'PA-1', 5000)");
        const res = await get(await person(["report.marketing.view", "marketing.partner-payment.view"]), MARKETING, "partner-dues");
        assert.deepEqual(res.body.data.rows.map((r) => r.campaign_no), ["CMP-1"]);
        const without = await get(await person(["report.marketing.view"]), MARKETING, "partner-dues");
        assert.equal(without.status, 403);
    });
    const download = (token, base, report) => fetch(`${h.url()}${CONTEXTS.REPORT}${base}?report=${report}`, { headers: { authorization: `Bearer ${token}` } });

    it("downloads the customer list as a sheet with the same people on it, and refuses it to someone who may only look", async () => {
        const base = SUB_CONTEXTS.CUSTOMER_REPORT + ROUTES.DOWNLOAD_CUSTOMER_REPORT;
        assert.equal((await download(await person([...SELLS, "report.customer.view"]), base, "customer-list")).status, 403);

        const res = await download(await person([...SELLS, "report.customer.view", "report.customer.export"]), base, "customer-list");
        assert.equal(res.status, 200);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
        const names = [];
        workbook.worksheets[0].eachRow((row) => names.push(...row.values.slice(1).map((v) => String(v ?? ""))));
        assert.ok(names.includes("Rina") && names.includes("Mita"));
    });

    it("downloads a marketing report as a sheet, and refuses it to someone who may only look", async () => {
        const base = SUB_CONTEXTS.MARKETING_REPORT + ROUTES.DOWNLOAD_MARKETING_REPORT;
        assert.equal((await download(await person(["report.marketing.view"]), base, "campaign-costs")).status, 403);

        const res = await download(await person(["report.marketing.view", "report.marketing.export"]), base, "campaign-costs");
        assert.equal(res.status, 200);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
        assert.ok(workbook.worksheets.length > 0);
    });
});

describe("pre-order deposits held", () => {
    it("names the customer and phone of each booking whose advance is still held", async () => {
        await h.reset();
        await h.query("TRUNCATE pre_orders, customers CASCADE");
        await h.query("INSERT INTO customers (oid, name, phone, status) VALUES ('CU-9', 'Rina', '01711-222333', 'Active')");
        await h.query("INSERT INTO pre_orders (oid, preorder_no, customer_oid, total_amount, advance_paid, status) VALUES ('PO-9', 'PRE-0009', 'CU-9', 3000, 1000, 'Pending')");

        const res = await sales_report(await person(["report.sales.view", "sales.pre-order.view"]), "pre-order-deposits", "");

        assert.equal(res.status, 200, JSON.stringify(res.body));
        const row = res.body.data.rows.find((r) => r.preorder_no === "PRE-0009");
        assert.deepEqual([row.customer, row.phone, row.held_money], ["Rina", "01711-222333", 1000]);
    });
});
