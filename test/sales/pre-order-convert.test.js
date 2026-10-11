const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const h = require("../support/harness");
const { execute_transaction } = require("../../src/db/database");
const { openBatch } = require("../../src/routes/sales/utils/stock-movement");
const { reload_location_index } = require("../../src/routes/sales/location/utils/location-index");
const { invalidateSettings } = require("../../src/utils/settings-cache");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const PRE = CONTEXTS.SALES + SUB_CONTEXTS.PRE_ORDER;
const BOOK = PRE + ROUTES.CREATE_PRE_ORDER;
const FOR_CONVERSION = PRE + ROUTES.GET_PRE_ORDER_FOR_CONVERSION;
const CREATE_ORDER = CONTEXTS.SALES + SUB_CONTEXTS.ONLINE + ROUTES.CREATE_ONLINE_ORDER;
const CANCEL_ORDER = CONTEXTS.SALES + SUB_CONTEXTS.ORDER + ROUTES.CANCEL_ORDER;
const EDIT_ORDER = CONTEXTS.SALES + SUB_CONTEXTS.ONLINE + ROUTES.EDIT_ONLINE_ORDER;
const ALL = ["sales.pre-order.view", "sales.pre-order.create", "sales.pre-order.convert", "sales.online.view", "sales.online.create"];
const USER = "owner@arithmalabs.test";
const SOURCE = uuidv4();
const THANA = "T-Dhaka-Mohammadpur";
const PHONE = "01711000111";

before(h.start);
after(h.stop);

let seq = 0;
const person = async (permissions = ALL) => (await h.sign_in(await h.seed_user({ email: `convert${++seq}@arithmalabs.test`, permissions }))).access;
const get = (route, token) => h.call(route, { method: "GET", token });

let kurti;
let scarf;
const batch = async (product, quantity, price = 1450, max_discount = 100) => {
    const oid = uuidv4();
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, selling_price, maximum_discount, intended_use, status) VALUES ($1, $2, $3, $4, $4, 700, $5, $6, 'for_sale', 'ready_for_sale')", [oid, `B-${oid.slice(0, 4)}`, product, quantity, price, max_discount]);
    await execute_transaction((tx) => openBatch(tx, { inventory_oid: oid, quantity, reason: "opening_stock", source_oid: oid, user_id: USER }));
    return oid;
};
const book = async (token, lines, extra = {}) => {
    const oid = uuidv4();
    const saved = await h.call(BOOK, { body: { oid, customer: { phone: PHONE, name: "Nusrat" }, lines, ...extra }, token });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    return { oid, preorder_no: saved.body.data.preorder_no };
};
// An online order as the page sends it: priced from the batch, the discount per unit.
const order = (pre_order_oid, lines, extra = {}) => {
    const total_amount = lines.reduce((sum, line) => sum + (line.price - (line.discount ?? 0)) * line.quantity, 0) + 60;
    return {
        oid: uuidv4(),
        pre_order_oid,
        customer: { phone: PHONE, name: "Nusrat" },
        address: { recipient_name: "Nusrat", address_line: "5/5, Gaznabi Road", district_oid: "BD-Dhaka", thana_oid: THANA },
        source_oid: SOURCE,
        payment_type: "COD",
        delivery_charge: 60,
        total_amount,
        lines: lines.map(({ inventory_oid, quantity, discount = 0 }) => ({ inventory_oid, quantity, discount })),
        ...extra,
    };
};
const booking_status = async (oid) => (await h.query("SELECT status, converted_order_oid FROM pre_orders WHERE oid = $1", [oid]))[0];
// Every batch's movement rows add up to what it holds, and the last balance is it.
const assert_balanced = async (inventory_oid) => {
    const [{ on_hand }] = await h.query("SELECT quantity_available::int AS on_hand FROM inventory WHERE oid = $1", [inventory_oid]);
    const rows = await h.query("SELECT quantity, balance_after FROM stock_movement WHERE inventory_oid = $1 ORDER BY created_on, oid", [inventory_oid]);
    assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), on_hand);
    assert.equal(rows.at(-1).balance_after, on_hand);
};
const held = async (order_oid) => (await h.query("SELECT COALESCE(SUM(quantity), 0)::int AS units FROM stock_hold WHERE order_oid = $1 AND status = 'Active'", [order_oid]))[0].units;

describe("turning a booking into an online order", () => {
    beforeEach(async () => {
        await h.query("TRUNCATE pre_order_status_history, pre_order_items, pre_orders, stock_movement, stock_hold, product_stats, order_status_history, order_items, online_order, orders, customer_address, customers, order_source, activity_log, inventory, product, sub_categories, categories, thana, district, division, settings CASCADE");
        await h.query("INSERT INTO division (oid, name_en, name_bn) VALUES ('BD-Dhaka-Division', 'Dhaka Division', 'ঢাকা বিভাগ')");
        await h.query("INSERT INTO district (oid, name_en, name_bn, division_oid) VALUES ('BD-Dhaka', 'Dhaka', 'ঢাকা', 'BD-Dhaka-Division')");
        await h.query("INSERT INTO thana (oid, name_en, name_bn, type, postal_code, district_oid) VALUES ($1, 'Mohammadpur', 'মোহাম্মদপুর', 'Thana', '1207', 'BD-Dhaka')", [THANA]);
        await h.query("INSERT INTO settings (oid, name, delivery_charge_inside, delivery_charge_outside, home_district_oid) VALUES ($1, 'A boutique', 60, 120, 'BD-Dhaka')", [uuidv4()]);
        await h.query("INSERT INTO order_source (oid, platform, name, status) VALUES ($1, 'Facebook', 'Facebook page', 'Active')", [SOURCE]);
        invalidateSettings();
        await reload_location_index();
        const category = uuidv4();
        const sub_category = uuidv4();
        kurti = uuidv4();
        scarf = uuidv4();
        await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
        await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Tops', 'TOPS', $2, 'Active')", [sub_category, category]);
        await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Block print kurti', 'KURTI-1', $3, $4, 5, 'Active'), ($2, 'Silk scarf', 'SCARF-1', $3, $4, 5, 'Active')", [kurti, scarf, category, sub_category]);
    });

    it("makes the order from the booking in one step: stock held, the advance as paid, the booking converted and linked", async () => {
        const token = await person();
        const kurti_batch = await batch(kurti, 10);
        const scarf_batch = await batch(scarf, 5, 900, 50);
        const booked = await book(token, [{ product_oid: kurti, quantity: 2, unit_price: 1400 }], { advance_paid: 500, advance_method: "bkash" });

        const conversion = (await get(`${FOR_CONVERSION}/${booked.oid}`, token)).body.data;
        assert.deepEqual({ phone: conversion.customer_phone, advance: conversion.advance, batch: conversion.lines[0].batches[0].inventory_oid, sellable: conversion.lines[0].batches[0].sellable_quantity }, { phone: PHONE, advance: 500, batch: kurti_batch, sellable: 10 });

        // The booked kurti at the booked price, 50 off the batch's 1450, and a scarf the customer added.
        const body = order(booked.oid, [{ inventory_oid: kurti_batch, quantity: 2, price: 1450, discount: 50 }, { inventory_oid: scarf_batch, quantity: 1, price: 900 }], { payment_type: "ADVANCE", payment_method: "bkash", amount_paid: 500 });
        const made = await h.call(CREATE_ORDER, { body, token });
        assert.equal(made.status, 200, JSON.stringify(made.body));

        const [placed] = await h.query("SELECT status, pre_order_oid, amount_paid::int, payment_status FROM orders WHERE oid = $1", [body.oid]);
        assert.deepEqual(placed, { status: "Pending", pre_order_oid: booked.oid, amount_paid: 500, payment_status: "partially_paid" });
        assert.equal(await held(body.oid), 3, "the order holds its stock, as any online order");
        assert.deepEqual(await booking_status(booked.oid), { status: "Converted", converted_order_oid: body.oid });
        const links = await h.query("SELECT product_oid, pre_order_item_oid IS NOT NULL AS linked FROM order_items WHERE order_oid = $1 ORDER BY product_name", [body.oid]);
        assert.deepEqual(links.map((row) => [row.product_oid, row.linked]), [[kurti, true], [scarf, false]], "the added scarf carries no booking link");
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM stock_movement WHERE inventory_oid = ANY($1)", [[kurti_batch, scarf_batch]]))[0].n, 2, "nothing physical moves until dispatch");
        await assert_balanced(kurti_batch);
        await assert_balanced(scarf_batch);
    });

    it("refuses to convert twice: the second Convert finds the booking already an order", async () => {
        const token = await person();
        const kurti_batch = await batch(kurti, 10);
        const booked = await book(token, [{ product_oid: kurti, quantity: 1, unit_price: 1450 }]);
        const lines = [{ inventory_oid: kurti_batch, quantity: 1, price: 1450 }];
        const [first, second] = await Promise.all([h.call(CREATE_ORDER, { body: order(booked.oid, lines), token }), h.call(CREATE_ORDER, { body: order(booked.oid, lines), token })]);
        assert.deepEqual([first.status, second.status].sort(), [200, 409]);
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM orders WHERE pre_order_oid = $1", [booked.oid]))[0].n, 1);
        assert.equal(await held([first, second].find((r) => r.status === 200).body.data.oid), 1, "the refused one held nothing");
    });

    it("refuses fewer units than booked, another customer's phone, or the advance not taken as paid, and writes nothing", async () => {
        const token = await person();
        const kurti_batch = await batch(kurti, 10);
        const booked = await book(token, [{ product_oid: kurti, quantity: 2, unit_price: 1450 }], { advance_paid: 300, advance_method: "cash" });
        const paid = { payment_type: "ADVANCE", payment_method: "cash", amount_paid: 300 };

        const fewer = await h.call(CREATE_ORDER, { body: order(booked.oid, [{ inventory_oid: kurti_batch, quantity: 1, price: 1450 }], paid), token });
        assert.equal(fewer.status, 409);
        assert.match(fewer.body.message, /pre-ordered for 2/);
        const someone_else = await h.call(CREATE_ORDER, { body: { ...order(booked.oid, [{ inventory_oid: kurti_batch, quantity: 2, price: 1450 }], paid), customer: { phone: "01811999888", name: "Someone else" } }, token });
        assert.equal(someone_else.status, 409);
        const unpaid = await h.call(CREATE_ORDER, { body: order(booked.oid, [{ inventory_oid: kurti_batch, quantity: 2, price: 1450 }]), token });
        assert.equal(unpaid.status, 409, "a COD order would forget the advance");

        assert.deepEqual(await booking_status(booked.oid), { status: "Pending", converted_order_oid: null });
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM orders"))[0].n, 0);
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM stock_hold"))[0].n, 0);
    });

    it("lets only someone who may convert do it, with an online order permission too", async () => {
        const kurti_batch = await batch(kurti, 10);
        const booked = await book(await person(), [{ product_oid: kurti, quantity: 1, unit_price: 1450 }]);
        const seller = await person(["sales.online.view", "sales.online.create"]);
        assert.equal((await h.call(CREATE_ORDER, { body: order(booked.oid, [{ inventory_oid: kurti_batch, quantity: 1, price: 1450 }]), token: seller })).status, 403);
        assert.equal((await get(`${FOR_CONVERSION}/${booked.oid}`, seller)).status, 403);
        assert.equal((await get(`${FOR_CONVERSION}/${booked.oid}`, await person(["sales.pre-order.view", "sales.pre-order.convert"]))).status, 403);
        assert.equal((await booking_status(booked.oid)).status, "Pending");
    });

    it("keeps the booking's rules when the order is edited: never fewer units, never the advance forgotten, the lines still linked", async () => {
        const token = await person([...ALL, "sales.order.edit"]);
        const kurti_batch = await batch(kurti, 10);
        const booked = await book(token, [{ product_oid: kurti, quantity: 2, unit_price: 1450 }], { advance_paid: 500, advance_method: "bkash" });
        const paid = { payment_type: "ADVANCE", payment_method: "bkash", amount_paid: 500 };
        const body = order(booked.oid, [{ inventory_oid: kurti_batch, quantity: 2, price: 1450 }], paid);
        assert.equal((await h.call(CREATE_ORDER, { body, token })).status, 200);

        const as_cod = { ...order(null, [{ inventory_oid: kurti_batch, quantity: 2, price: 1450 }]), oid: body.oid };
        const cod = await h.call(EDIT_ORDER, { body: as_cod, token });
        assert.equal(cod.status, 409, "a COD edit would forget the 500 the customer paid");
        const fewer = await h.call(EDIT_ORDER, { body: { ...order(null, [{ inventory_oid: kurti_batch, quantity: 1, price: 1450 }], paid), oid: body.oid }, token });
        assert.equal(fewer.status, 409);

        const more = await h.call(EDIT_ORDER, { body: { ...order(null, [{ inventory_oid: kurti_batch, quantity: 3, price: 1450 }], paid), oid: body.oid }, token });
        assert.equal(more.status, 200, JSON.stringify(more.body));
        const [placed] = await h.query("SELECT amount_paid::int, pre_order_oid FROM orders WHERE oid = $1", [body.oid]);
        assert.deepEqual(placed, { amount_paid: 500, pre_order_oid: booked.oid });
        assert.equal((await h.query("SELECT COUNT(*)::int AS n FROM order_items WHERE order_oid = $1 AND pre_order_item_oid IS NOT NULL", [body.oid]))[0].n, 1, "the edit keeps the line linked to its booked line");
        assert.equal(await held(body.oid), 3);
        await assert_balanced(kurti_batch);
    });

    it("owes the booking's advance back when the order made from it is cancelled before dispatch", async () => {
        const token = await person([...ALL, "sales.order.view", "sales.order.cancel"]);
        const kurti_batch = await batch(kurti, 10);
        const booked = await book(token, [{ product_oid: kurti, quantity: 2, unit_price: 1450 }], { advance_paid: 500, advance_method: "bkash" });
        const body = order(booked.oid, [{ inventory_oid: kurti_batch, quantity: 2, price: 1450 }], { payment_type: "ADVANCE", payment_method: "bkash", amount_paid: 500 });
        assert.equal((await h.call(CREATE_ORDER, { body, token })).status, 200);

        const cancelled = await h.call(CANCEL_ORDER, { body: { oid: body.oid, reason_code: "changed_mind" }, token });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        const [after] = await h.query("SELECT status, refund_status, refund_due::int FROM orders WHERE oid = $1", [body.oid]);
        assert.deepEqual(after, { status: "Cancelled", refund_status: "ToRefund", refund_due: 500 }, "the 500 the customer paid on the booking is owed back on the order");
        assert.equal(await held(body.oid), 0, "the held units are free again");
        assert.equal((await booking_status(booked.oid)).status, "Converted", "the booking stays the record that it became this order");
        await assert_balanced(kurti_batch);
    });
});
