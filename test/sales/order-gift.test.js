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
const ONLINE = CONTEXTS.SALES + SUB_CONTEXTS.ONLINE;
const GIVEAWAY = CONTEXTS.SALES + SUB_CONTEXTS.GIVEAWAY;
const ADD = GIVEAWAY + ROUTES.ADD_ORDER_GIFT;
const REMOVE = GIVEAWAY + ROUTES.REMOVE_ORDER_GIFT;
const CONFIRM_RETURN = CONTEXTS.SALES + SUB_CONTEXTS.RETURN + ROUTES.CONFIRM_RETURN;

const MANAGER = ["sales.online.view", "sales.online.create", "sales.order.view", "sales.order.confirm", "sales.order.cancel", "sales.order.dispatch", "sales.order.deliver", "sales.order.edit", "sales.return.view", "sales.return.confirm", "sales.giveaway.view", "sales.giveaway.create", "sales.giveaway.cancel"];
const USER = "owner@arithmalabs.test";
const SOURCE = uuidv4();
const MOHAMMADPUR = "T-Dhaka-Mohammadpur";

before(h.start);
after(h.stop);

let seq = 0;
const person = async (permissions = MANAGER) => (await h.sign_in(await h.seed_user({ email: `ordergift${++seq}@arithmalabs.test`, permissions }))).access;

let product;
const batch = async (quantity) => {
    const oid = uuidv4();
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, selling_price, maximum_discount, intended_use, status) VALUES ($1, $2, $3, $4, $4, 700, 1450, 100, 'for_sale', 'ready_for_sale')", [oid, `B-${oid.slice(0, 4)}`, product, quantity]);
    await execute_transaction((tx) => openBatch(tx, { inventory_oid: oid, quantity, reason: "opening_stock", source_oid: oid, user_id: USER }));
    return oid;
};
const on_hand = async (oid) => (await h.query("SELECT quantity_available::int AS q FROM inventory WHERE oid = $1", [oid]))[0].q;
const movements = (oid) => h.query("SELECT reason, quantity, balance_after, source_oid FROM stock_movement WHERE inventory_oid = $1 ORDER BY created_on, oid", [oid]);
const assert_balanced = async (oid) => {
    const rows = await movements(oid);
    assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), await on_hand(oid));
    assert.equal(rows.at(-1).balance_after, await on_hand(oid));
};
const gift_holds = (gift) => h.query("SELECT h.status, h.quantity::int AS quantity FROM stock_hold h JOIN giveaway_line gl ON gl.oid = h.giveaway_line_oid WHERE gl.giveaway_oid = $1", [gift]);
const gift_status = async (gift) => (await h.query("SELECT status FROM giveaway WHERE oid = $1", [gift]))[0].status;

const order_body = (oid, inventory_oid, quantity = 1) => ({ oid, customer: { phone: "01987654321", name: "Person A" }, address: { recipient_name: "Person A", address_line: "5/5, Gaznabi Road", district_oid: "BD-Dhaka", thana_oid: MOHAMMADPUR, area_text: "Gaznabi Road" }, source_oid: SOURCE, payment_type: "COD", delivery_charge: 60, total_amount: 1450 * quantity + 60, lines: [{ inventory_oid, quantity, discount: 0 }] });
const place = async (token, inventory_oid) => {
    const oid = uuidv4();
    const res = await h.call(ONLINE + ROUTES.CREATE_ONLINE_ORDER, { body: order_body(oid, inventory_oid), token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return oid;
};
const add_gift = async (token, order_oid, inventory_oid, quantity = 1) => {
    const oid = uuidv4();
    const res = await h.call(ADD, { body: { oid, order_oid, note: "Thank you for ordering", lines: [{ inventory_oid, quantity }] }, token });
    return { oid, res };
};
const dispatch = async (token, oid) => {
    await h.call(ORDER + ROUTES.CONFIRM_ORDER, { body: { oid, confirmed_via: "PhoneCall" }, token });
    const res = await h.call(ORDER + ROUTES.DISPATCH_ORDER, { body: { oid, courier: "Pathao" }, token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
};

describe("a gift with an online order", () => {
    beforeEach(async () => {
        await h.query("TRUNCATE stock_movement, stock_hold, giveaway_line, giveaway, activity_log, product_stats, dispose_details, product_dispose, return_details, product_return, order_status_history, order_items, online_order, orders, customer_address, customers, order_source, inventory, product, sub_categories, categories, location_alias, area, post_office, thana, district, division, settings CASCADE");
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
        await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ($1, 'Clothing', 'CLOT', 'Active')", [category]);
        await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ($1, 'Tops', 'TOPS', $2, 'Active')", [sub_category, category]);
        await h.query("INSERT INTO product (oid, name, sku, category_oid, sub_category_oid, restock_threshold, status) VALUES ($1, 'Floral kurti', 'KURTI-38', $2, $3, 5, 'Active')", [product, category, sub_category]);
    });

    it("holds the gift with the order, and dispatch takes it as given away, apart from the sale", async () => {
        const token = await person();
        const sold = await batch(5);
        const scarf = await batch(3);
        const order = await place(token, sold);
        const { oid: gift, res } = await add_gift(token, order, scarf, 2);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.deepEqual(await gift_holds(gift), [{ status: "Active", quantity: 2 }]);
        assert.equal(await on_hand(scarf), 3, "held, not taken");
        assert.equal((await add_gift(token, order, scarf, 2)).res.status, 409, "only one unit is free");

        await dispatch(token, order);
        assert.equal(await gift_status(gift), "Given");
        assert.deepEqual((await movements(scarf)).at(-1), { reason: "given_away", quantity: -2, balance_after: 1, source_oid: gift });
        assert.deepEqual((await movements(sold)).at(-1), { reason: "dispatched", quantity: -1, balance_after: 4, source_oid: order });
        await assert_balanced(scarf);
        await assert_balanced(sold);
        assert.equal((await add_gift(token, order, scarf, 1)).res.status, 409, "the parcel has left");
    });

    it("releases the gift's hold when the order is cancelled, and moves no stock", async () => {
        const token = await person();
        const b1 = await batch(5);
        const order = await place(token, b1);
        const { oid: gift } = await add_gift(token, order, b1, 1);
        const res = await h.call(ORDER + ROUTES.CANCEL_ORDER, { body: { oid: order, reason_code: "duplicate" }, token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(await gift_status(gift), "Cancelled");
        assert.deepEqual(await gift_holds(gift), [{ status: "Released", quantity: 1 }]);
        assert.equal(await on_hand(b1), 5);
        await assert_balanced(b1);
    });

    it("keeps the gift held when the order is edited", async () => {
        const token = await person();
        const b1 = await batch(5);
        const order = await place(token, b1);
        const { oid: gift } = await add_gift(token, order, b1, 1);
        const form = await h.call(`${ONLINE + ROUTES.GET_ONLINE_ORDER_FOR_EDIT}?oid=${order}`, { method: "GET", token });
        assert.equal(form.status, 200, JSON.stringify(form.body));
        assert.equal(form.body.data.lines[0].sellable, 4, "the edit form never offers the gift's unit");
        const res = await h.call(ONLINE + ROUTES.EDIT_ONLINE_ORDER, { body: order_body(order, b1, 4), token });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.deepEqual(await gift_holds(gift), [{ status: "Active", quantity: 1 }]);
        assert.equal((await h.call(ONLINE + ROUTES.EDIT_ONLINE_ORDER, { body: order_body(order, b1, 5), token })).status, 409, "the gift's unit is not the order's to take");
    });

    it("takes a gift out of a parcel that has not left, releasing its hold", async () => {
        const token = await person();
        const b1 = await batch(5);
        const order = await place(token, b1);
        const { oid: gift } = await add_gift(token, order, b1, 2);
        assert.equal((await h.call(REMOVE, { body: { oid: gift }, token })).status, 200);
        assert.equal(await gift_status(gift), "Cancelled");
        assert.deepEqual(await gift_holds(gift), [{ status: "Released", quantity: 2 }]);
        assert.equal((await h.call(REMOVE, { body: { oid: gift }, token })).status, 409);
        await dispatch(token, order);
        assert.equal(await on_hand(b1), 4, "only the order's unit left");
        await assert_balanced(b1);
    });

    it("puts a refused parcel's gift back in its batch when the return is confirmed", async () => {
        const token = await person();
        const sold = await batch(5);
        const scarf = await batch(3);
        const order = await place(token, sold);
        const { oid: gift } = await add_gift(token, order, scarf, 1);
        await dispatch(token, order);
        const refused = await h.call(ORDER + ROUTES.MARK_ORDER_NOT_DELIVERED, { body: { oid: order, reason: "refused" }, token });
        assert.equal(refused.status, 200, JSON.stringify(refused.body));
        const back = await h.call(CONFIRM_RETURN, { body: { oid: refused.body.data.return_oid }, token });
        assert.equal(back.status, 200, JSON.stringify(back.body));
        assert.equal(await gift_status(gift), "Returned");
        assert.equal(await on_hand(scarf), 3);
        assert.deepEqual((await movements(scarf)).at(-1), { reason: "returned", quantity: 1, balance_after: 3, source_oid: gift });
        await assert_balanced(scarf);
        await assert_balanced(sold);
    });

    it("needs the giveaway permissions", async () => {
        const token = await person();
        const b1 = await batch(5);
        const order = await place(token, b1);
        const seller = await person(MANAGER.filter((code) => !code.startsWith("sales.giveaway")));
        assert.equal((await add_gift(seller, order, b1, 1)).res.status, 403);
        const { oid: gift } = await add_gift(token, order, b1, 1);
        assert.equal((await h.call(REMOVE, { body: { oid: gift }, token: seller })).status, 403);
    });
});
