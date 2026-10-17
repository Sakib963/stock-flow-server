const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { execute_transaction } = require("../../src/db/database");
const { openBatch } = require("../../src/routes/sales/utils/stock-movement");
const { reload_location_index } = require("../../src/routes/sales/location/utils/location-index");
const { invalidateSettings } = require("../../src/utils/settings-cache");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const ORDER = CONTEXTS.SALES + SUB_CONTEXTS.ORDER;
const BATCH = CONTEXTS.SALES + SUB_CONTEXTS.DELIVERY_BATCH;
const CREATE_ORDER = CONTEXTS.SALES + SUB_CONTEXTS.ONLINE + ROUTES.CREATE_ONLINE_ORDER;
const CONFIRM = ORDER + ROUTES.CONFIRM_ORDER;
const CANCEL_ORDER = ORDER + ROUTES.CANCEL_ORDER;
const READY = BATCH + ROUTES.GET_ORDERS_READY_TO_SEND;
const LIST = BATCH + ROUTES.GET_DELIVERY_BATCH_LIST;
const CREATE = BATCH + ROUTES.CREATE_DELIVERY_BATCH;
const UPDATE = BATCH + ROUTES.UPDATE_DELIVERY_BATCH_ORDERS;
const FILE = BATCH + ROUTES.GET_DELIVERY_BATCH_UPLOAD_FILE;
const DETAILS = BATCH + ROUTES.GET_DELIVERY_BATCH_DETAILS;
const HAND_OVER = BATCH + ROUTES.HAND_OVER_DELIVERY_BATCH;
const DELIVER = BATCH + ROUTES.DELIVER_DELIVERY_BATCH;
const CANCEL = BATCH + ROUTES.CANCEL_DELIVERY_BATCH;

const ALL = ["sales.online.view", "sales.online.create", "sales.order.view", "sales.order.confirm", "sales.order.cancel", "sales.order.dispatch", "sales.delivery-batch.view", "sales.delivery-batch.create", "sales.delivery-batch.edit", "sales.delivery-batch.dispatch", "sales.delivery-batch.deliver", "sales.delivery-batch.cancel"];
const USER = "owner@arithmalabs.test";
const SOURCE = uuidv4();
const MOHAMMADPUR = "T-Dhaka-Mohammadpur";

before(h.start);
after(h.stop);

let seq = 0;
const person = async (permissions = ALL) => (await h.sign_in(await h.seed_user({ email: `packer${++seq}@arithmalabs.test`, permissions }))).access;
const get = (route, token) => h.call(route, { method: "GET", token });

let product;
let shelf;
const seed = async () => {
    await h.query("TRUNCATE delivery_batch_order, delivery_batch, stock_movement, stock_hold, product_stats, order_status_history, order_items, online_order, orders, customer_address, customers, order_source, inventory, product, sub_categories, categories, location_alias, area, post_office, thana, district, division, settings CASCADE");
    await h.query("INSERT INTO division (oid, name_en, name_bn) VALUES ('BD-Dhaka-Division', 'Dhaka Division', 'ঢাকা বিভাগ')");
    await h.query("INSERT INTO district (oid, name_en, name_bn, division_oid) VALUES ('BD-Dhaka', 'Dhaka', 'ঢাকা', 'BD-Dhaka-Division')");
    await h.query("INSERT INTO thana (oid, name_en, name_bn, type, postal_code, district_oid) VALUES ($1, 'Mohammadpur', 'মোহাম্মদপুর', 'Thana', '1207', 'BD-Dhaka')", [MOHAMMADPUR]);
    await h.query("INSERT INTO settings (oid, name, delivery_charge_inside, delivery_charge_outside, home_district_oid) VALUES ($1, 'A boutique', 60, 120, 'BD-Dhaka')", [uuidv4()]);
    await h.query("INSERT INTO order_source (oid, platform, name, status) VALUES ($1, 'Facebook', 'Facebook page', 'Active')", [SOURCE]);
    invalidateSettings();
    await reload_location_index();
    const category = uuidv4();
    const sub_category = uuidv4();
    product = uuidv4();
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Skincare', 'SKIN', 'Active')", [category]);
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Serums', 'SERU', $2, 'Active')", [sub_category, category]);
    await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Glow serum', 'GLOW-1', $2, $3, 5, 'Active')", [product, category, sub_category]);
    shelf = uuidv4();
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, selling_price, maximum_discount, intended_use, status) VALUES ($1, 'B-TEST-0001', $2, 20, 20, 700, 1450, 100, 'for_sale', 'ready_for_sale')", [shelf, product]);
    await execute_transaction((tx) => openBatch(tx, { inventory_oid: shelf, quantity: 20, reason: "opening_stock", source_oid: shelf, user_id: USER }));
};

const on_hand = async () => (await h.query("SELECT quantity_available::int AS q FROM inventory WHERE oid = $1", [shelf]))[0].q;
const assert_balanced = async () => {
    const rows = await h.query("SELECT quantity, balance_after FROM stock_movement WHERE inventory_oid = $1 ORDER BY created_on, oid", [shelf]);
    const held = await on_hand();
    assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), held);
    assert.equal(rows.at(-1).balance_after, held);
};
const order_row = async (oid) => (await h.query("SELECT o.status, o.dispatched_on, oo.delivery_status, oo.courier FROM orders o JOIN online_order oo ON oo.order_oid = o.oid WHERE o.oid = $1", [oid]))[0];

// An online order of `quantity` serums, confirmed unless asked not to: ready to send.
const order = async (token, { quantity = 2, confirm = true, phone = "01987654321", advance = 0 } = {}) => {
    const oid = uuidv4();
    const body = { oid, customer: { phone, name: "Person A" }, address: { recipient_name: "Person A", address_line: "5/5, Gaznabi Road", district_oid: "BD-Dhaka", thana_oid: MOHAMMADPUR, area_text: "Gaznabi Road" }, source_oid: SOURCE, ...(advance ? { payment_type: "ADVANCE", payment_method: "bkash", amount_paid: advance } : { payment_type: "COD" }), delivery_charge: 60, total_amount: 1450 * quantity + 60, lines: [{ inventory_oid: shelf, quantity, discount: 0 }] };
    const placed = await h.call(CREATE_ORDER, { body, token });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    if (confirm) assert.equal((await h.call(CONFIRM, { body: { oid, confirmed_via: "PhoneCall" }, token })).status, 200);
    return oid;
};
const make = async (token, order_oids, courier = "Pathao") => {
    const oid = uuidv4();
    const res = await h.call(CREATE, { body: { oid, courier, order_oids }, token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return { oid, batch_no: res.body.data.batch_no };
};

describe("delivery batches", () => {
    let token;
    beforeEach(async () => {
        await h.reset();
        await seed();
        token = await person();
    });

    it("proposes only confirmed orders not yet with a courier, and never one already in an open batch", async () => {
        const a = await order(token);
        const b = await order(token);
        await order(token, { confirm: false });
        assert.deepEqual((await get(READY, token)).body.data.map((row) => row.oid).sort(), [a, b].sort());

        const first = await make(token, [a]);
        assert.match(first.batch_no, /^DB-\d{4}-\d{4}$/);
        assert.deepEqual((await get(READY, token)).body.data.map((row) => row.oid), [b]);
        const twice = await h.call(CREATE, { body: { oid: uuidv4(), courier: "Pathao", order_oids: [a] }, token });
        assert.equal(twice.status, 409, "an order sits in one open batch only");
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM delivery_batch"))[0].n, 1);
    });

    it("gives the same batch back to a save repeated after a lost answer", async () => {
        const a = await order(token);
        const body = { oid: uuidv4(), courier: "Pathao", order_oids: [a] };
        const first = await h.call(CREATE, { body, token });
        const again = await h.call(CREATE, { body, token });
        assert.equal(again.status, 200);
        assert.equal(again.body.data.batch_no, first.body.data.batch_no);
    });

    it("writes Pathao's upload file and changes no order or stock doing it", async () => {
        const a = await order(token, { quantity: 3 });
        const { oid, batch_no } = await make(token, [a]);
        const before = await on_hand();
        const file = await get(`${FILE}/${oid}`, token);
        assert.equal(file.status, 200);
        const [header, row] = String(file.body).trim().split("\r\n");
        assert.equal(header, "ItemType,StoreName,MerchantOrderId,RecipientName(*),RecipientPhone(*),RecipientAddress(*),RecipientCity(*),RecipientZone(*),RecipientArea,AmountToCollect(*),ItemQuantity,ItemWeight,ItemDesc,SpecialInstruction");
        const invoice = (await h.query("SELECT invoice_no FROM orders WHERE oid = $1", [a]))[0].invoice_no;
        assert.equal(row, `parcel,,${invoice},Person A,01987654321,"5/5, Gaznabi Road",Dhaka,Mohammadpur,Gaznabi Road,4410,3,,Glow serum x3,`);
        assert.equal(await on_hand(), before);
        assert.equal((await order_row(a)).delivery_status, "Preparing");
        assert.ok(batch_no);
    });

    it("dispatches every ready order at handover once, leaves out and frees a cancelled one, and a second press changes nothing", async () => {
        const a = await order(token);
        const b = await order(token, { quantity: 1 });
        const gone = await order(token, { quantity: 1 });
        const { oid, batch_no } = await make(token, [a, b, gone]);
        assert.equal((await h.call(CANCEL_ORDER, { body: { oid: gone, reason_code: "changed_mind" }, token })).status, 200);

        const handed = await h.call(HAND_OVER, { body: { oid }, token });
        assert.equal(handed.status, 200, JSON.stringify(handed.body));
        assert.equal(handed.body.data.dispatched, 2);
        assert.equal(handed.body.data.left_out.length, 1);
        for (const each of [a, b]) {
            const row = await order_row(each);
            assert.equal(row.delivery_status, "WithCourier");
            assert.equal(row.courier, "Pathao");
        }
        assert.equal(await on_hand(), 20 - 3, "held units left the shelf once");
        await assert_balanced();
        const reasons = await h.query("SELECT reason FROM order_status_history WHERE order_oid = $1 AND to_status = 'WithCourier'", [a]);
        assert.equal(reasons[0].reason, `Pathao batch ${batch_no}`);
        assert.equal((await h.query("SELECT active FROM delivery_batch_order WHERE order_oid = $1", [gone]))[0].active, false);
        for (const each of [a, b]) {
            const held = await h.query("SELECT status FROM stock_hold WHERE order_oid = $1", [each]);
            assert.ok(held.length && held.every((row) => row.status === "Deducted"), "every hold of a dispatched order is deducted, none left Active");
            const moved = await h.query("SELECT COUNT(*)::int AS n FROM stock_movement WHERE reason = 'dispatched' AND source_oid = $1", [each]);
            assert.equal(moved[0].n, held.length, "one dispatched movement per hold, against the order");
        }

        const ledger = await h.query("SELECT reason, quantity, balance_after, source_oid FROM stock_movement WHERE inventory_oid = $1 ORDER BY created_on, oid", [shelf]);
        let balance = 20;
        for (const row of ledger.slice(1)) {
            assert.equal(row.reason, "dispatched");
            assert.ok([a, b].includes(row.source_oid));
            balance += row.quantity;
            assert.equal(row.balance_after, balance, "each movement carries the shelf as it left it");
        }
        assert.deepEqual(ledger.slice(1).map((row) => [row.source_oid, row.quantity]).sort(), [[a, -2], [b, -1]].sort());
        assert.equal((await h.call(CANCEL_ORDER, { body: { oid: a, reason_code: "changed_mind" }, token })).status, 409, "a parcel with the courier can no longer be cancelled");

        const again = await h.call(HAND_OVER, { body: { oid }, token });
        assert.equal(again.status, 409);
        assert.equal(await on_hand(), 17);
        assert.equal((await get(`${DETAILS}/${oid}`, token)).body.data.status, "HandedOver");
    });

    it("marks the ticked orders delivered and leaves the others with the courier", async () => {
        const a = await order(token, { advance: 200 });
        const b = await order(token, { quantity: 1 });
        const { oid } = await make(token, [a, b]);
        assert.equal((await h.call(DELIVER, { body: { oid, order_oids: [a] }, token })).status, 409, "not handed over yet");
        assert.equal((await h.call(HAND_OVER, { body: { oid }, token })).status, 200);

        const moved = (await h.query("SELECT COUNT(*)::int AS n FROM stock_movement"))[0].n;
        const delivered = await h.call(DELIVER, { body: { oid, order_oids: [a] }, token });
        assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
        assert.equal((await order_row(a)).status, "Delivered");
        const sale = (await h.query("SELECT sold_on, payment_status, amount_paid::int AS paid, total_amount::int AS total FROM orders WHERE oid = $1", [a]))[0];
        assert.ok(sale.sold_on, "a delivered order is a sale");
        assert.deepEqual([sale.payment_status, sale.paid], ["paid", sale.total]);
        assert.equal((await h.query("SELECT total_sold::int AS n FROM product_stats WHERE product_oid = $1", [product]))[0].n, 2);
        assert.equal((await order_row(b)).delivery_status, "WithCourier");
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM stock_movement"))[0].n, moved, "delivering moves no stock");
        assert.equal((await h.call(DELIVER, { body: { oid, order_oids: [a] }, token })).status, 409, "an order is sold once");
        assert.equal((await h.query("SELECT sold_on FROM orders WHERE oid = $1", [a]))[0].sold_on.getTime(), sale.sold_on.getTime());
        assert.equal((await h.query("SELECT total_sold::int AS n FROM product_stats WHERE product_oid = $1", [product]))[0].n, 2);
        await assert_balanced();
    });

    it("says how a handed over batch ended once every parcel has an answer, and goes back to the courier when an answer is undone", async () => {
        const status = async (oid) => (await get(`${DETAILS}/${oid}`, token)).body.data.status;
        const answer = (oid, delivery_status) => h.query("UPDATE online_order SET delivery_status = $2 WHERE order_oid = $1", [oid, delivery_status]);
        const a = await order(token);
        const b = await order(token, { quantity: 1 });
        const mixed = await make(token, [a, b]);
        assert.equal((await h.call(HAND_OVER, { body: { oid: mixed.oid }, token })).status, 200);
        assert.equal((await h.call(DELIVER, { body: { oid: mixed.oid, order_oids: [a] }, token })).status, 200);
        assert.equal(await status(mixed.oid), "HandedOver", "one parcel is still with the courier");
        await answer(b, "Failed");
        assert.equal(await status(mixed.oid), "PartlyDelivered");
        const listed = await get(`${LIST}?status=PartlyDelivered`, token);
        assert.deepEqual(listed.body.data.rows.map((row) => [row.oid, row.status]), [[mixed.oid, "PartlyDelivered"]]);
        await answer(b, "WithCourier");
        assert.equal(await status(mixed.oid), "HandedOver");

        const c = await order(token, { quantity: 1 });
        const d = await order(token, { quantity: 1 });
        const whole = await make(token, [c]);
        const none = await make(token, [d]);
        for (const batch of [whole, none]) assert.equal((await h.call(HAND_OVER, { body: { oid: batch.oid }, token })).status, 200);
        assert.equal((await h.call(DELIVER, { body: { oid: whole.oid, order_oids: [c] }, token })).status, 200);
        await answer(d, "BackInShop");
        assert.equal(await status(whole.oid), "Delivered");
        assert.equal(await status(none.oid), "NotDelivered");
        assert.equal((await get(`${LIST}?include=stats`, token)).body.data.stats.handed_over, 1);
    });

    it("counts no money to collect for an order cancelled while in an open batch", async () => {
        const a = await order(token);
        const b = await order(token, { quantity: 1 });
        await make(token, [a, b]);
        assert.equal((await h.call(CANCEL_ORDER, { body: { oid: b, reason_code: "changed_mind" }, token })).status, 200);
        const row = (await get(LIST, token)).body.data.rows[0];
        assert.equal(Number(row.to_collect), 1450 * 2 + 60);
    });

    it("cancels only an open batch, which frees its orders for another", async () => {
        const a = await order(token);
        const { oid } = await make(token, [a]);
        assert.equal((await h.call(CANCEL, { body: { oid, note: "Rider did not come" }, token })).status, 200);
        await make(token, [a]);

        const b = await order(token, { quantity: 1 });
        const handed = await make(token, [b]);
        assert.equal((await h.call(HAND_OVER, { body: { oid: handed.oid }, token })).status, 200);
        assert.equal((await h.call(CANCEL, { body: { oid: handed.oid, note: "Too late" }, token })).status, 409, "stock has moved");
    });

    it("takes out and adds orders while open, and no longer once handed over", async () => {
        const a = await order(token);
        const b = await order(token, { quantity: 1 });
        const { oid } = await make(token, [a]);
        assert.equal((await h.call(UPDATE, { body: { oid, order_oids: [b] }, token })).status, 200);
        assert.deepEqual((await get(`${DETAILS}/${oid}`, token)).body.data.orders.map((row) => row.oid), [b]);
        assert.deepEqual((await get(READY, token)).body.data.map((row) => row.oid), [a], "a taken out order is free again");
        assert.equal((await h.call(HAND_OVER, { body: { oid }, token })).status, 200);
        assert.equal((await h.call(UPDATE, { body: { oid, order_oids: [a, b] }, token })).status, 409);
    });

    it("refuses someone without the permission, and someone who does not sell online", async () => {
        const a = await order(token);
        const { oid } = await make(token, [a]);
        const staff = await person(ALL.filter((code) => code !== "sales.delivery-batch.cancel"));
        assert.equal((await h.call(CANCEL, { body: { oid, note: "Not today" }, token: staff })).status, 403);
        const counter = await person(ALL.filter((code) => code !== "sales.online.view"));
        assert.equal((await get(READY, counter)).status, 403);
    });
});
