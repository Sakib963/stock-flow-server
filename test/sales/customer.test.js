const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { v4: uuidv4 } = require("uuid");
const ExcelJS = require("exceljs");
const h = require("../support/harness");
const { CONTEXTS, SUB_CONTEXTS, ROUTES } = require("../../src/utils/constant");

const BASE = CONTEXTS.SALES + SUB_CONTEXTS.CUSTOMER;
const LIST = BASE + ROUTES.GET_CUSTOMER_LIST;
const DETAILS = BASE + ROUTES.GET_CUSTOMER_DETAILS;
const FIND = BASE + ROUTES.FIND_CUSTOMER_BY_PHONE;
const CREATE = BASE + ROUTES.CREATE_CUSTOMER;
const UPDATE = BASE + ROUTES.UPDATE_CUSTOMER_DETAILS;
const FLAG = BASE + ROUTES.FLAG_CUSTOMER;
const ADD_ADDRESS = BASE + ROUTES.CREATE_CUSTOMER_ADDRESS;
const UPDATE_ADDRESS = BASE + ROUTES.UPDATE_CUSTOMER_ADDRESS;
const RETIRE_ADDRESS = BASE + ROUTES.RETIRE_CUSTOMER_ADDRESS;
const EXPORT = BASE + ROUTES.GENERATE_CUSTOMER_LIST_REPORT;

const EVERYTHING = ["sales.customer.view", "sales.customer.create", "sales.customer.edit", "sales.customer.export", "sales.pos.view", "sales.online.view"];

before(h.start);
after(h.stop);

const seed_places = async () => {
    await h.query("TRUNCATE customer_address, customers, return_details, product_return, online_order, order_items, orders, inventory, product, sub_categories, location_alias, area, post_office, thana, district, division CASCADE");
    await h.query("INSERT INTO division (oid, name_en, name_bn) VALUES ('BD-Dhaka-Division', 'Dhaka Division', 'ঢাকা বিভাগ'), ('BD-Rajshahi-Division', 'Rajshahi Division', 'রাজশাহী বিভাগ')");
    await h.query("INSERT INTO district (oid, name_en, name_bn, division_oid) VALUES ('BD-Dhaka', 'Dhaka', 'ঢাকা', 'BD-Dhaka-Division'), ('BD-Rajshahi', 'Rajshahi', 'রাজশাহী', 'BD-Rajshahi-Division')");
    await h.query("INSERT INTO thana (oid, name_en, name_bn, type, district_oid) VALUES ('T-Mohammadpur', 'Mohammadpur', 'মোহাম্মদপুর', 'Thana', 'BD-Dhaka'), ('T-Boalia', 'Boalia', 'বোয়ালিয়া', 'Thana', 'BD-Rajshahi')");
};

let seq = 0;
const person = async (permissions = EVERYTHING) => {
    const user = await h.seed_user({ email: `seller${++seq}@arithmalabs.test`, permissions });
    return (await h.sign_in(user)).access;
};

const home = { label: "Home", recipient_name: "Person A", address_line: "5/5 Gaznabi Road", district_oid: "BD-Dhaka", thana_oid: "T-Mohammadpur" };
const sister = { label: "Sister", recipient_name: "Person B", recipient_phone: "01811000000", address_line: "Shaheb Bazar", district_oid: "BD-Rajshahi", thana_oid: "T-Boalia" };

const create = async (token, body) => {
    const res = await h.call(CREATE, { body, token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.data.oid;
};

const addresses_of = (customer_oid) => h.query("SELECT oid, label, is_default, status FROM customer_address WHERE customer_oid = $1 ORDER BY created_on, label", [customer_oid]);

describe("one customer per phone", () => {
    let token;
    beforeEach(async () => {
        await h.reset();
        await seed_places();
        token = await person();
    });

    it("saves the phone in one form whichever way it was typed, with the first address as default", async () => {
        const oid = await create(token, { name: "Person A", phone: "+880 1987-654321", gender: "Female", age_band: "18_24", address: home });
        const [customer] = await h.query("SELECT phone, phone_normalized, gender, age_band, flag FROM customers WHERE oid = $1", [oid]);
        assert.deepEqual(customer, { phone: "01987654321", phone_normalized: "01987654321", gender: "Female", age_band: "18_24", flag: "None" });
        const [address] = await addresses_of(oid);
        assert.equal(address.is_default, true);
        const activity = await h.query("SELECT title FROM activity_log WHERE reference_oid = $1 ORDER BY title", [oid]);
        assert.deepEqual(activity.map((a) => a.title), ["Added address", "Created customer"]);
    });

    it("refuses a second customer with the same phone and names the one who has it", async () => {
        await create(token, { name: "Person A", phone: "01987654321" });
        const res = await h.call(CREATE, { body: { name: "Someone else", phone: "০১৯৮৭৬৫৪৩২১" }, token });
        assert.equal(res.status, 409);
        assert.match(res.body.message, /Person A/);
        assert.equal(res.body.data.field, "phone");
    });

    it("lets only one of two people saving the same new customer at once succeed", async () => {
        const [a, b] = await Promise.all([h.call(CREATE, { body: { name: "Person A", phone: "01711000000" }, token }), h.call(CREATE, { body: { name: "Person A", phone: "+8801711000000" }, token })]);
        assert.deepEqual([a.status, b.status].sort(), [200, 409]);
        const [{ count }] = await h.query("SELECT COUNT(*)::int AS count FROM customers");
        assert.equal(count, 1);
    });

    it("refuses a landline or a short number with what to ask for", async () => {
        const res = await h.call(CREATE, { body: { name: "Person A", phone: "0298765432" }, token });
        assert.equal(res.status, 400);
        assert.match(res.body.data.details[0], /11 digit number starting 01/);
    });

    it("saves nothing when the first address names a thana outside its district", async () => {
        const res = await h.call(CREATE, { body: { name: "Person A", phone: "01987654321", address: { ...home, thana_oid: "T-Boalia" } }, token });
        assert.equal(res.status, 400);
        assert.equal(res.body.data.field, "thana_oid");
        const [{ count }] = await h.query("SELECT COUNT(*)::int AS count FROM customers");
        assert.equal(count, 0);
    });

    it("refuses changing a phone to another customer's", async () => {
        await create(token, { name: "Person A", phone: "01987654321" });
        const b = await create(token, { name: "Person B", phone: "01811000000" });
        const res = await h.call(UPDATE, { body: { oid: b, name: "Person B", phone: "01987654321", status: "Active" }, token });
        assert.equal(res.status, 409);
        assert.equal(res.body.data.customer.name, "Person A");
    });

    it("refuses someone who may see customers but not add them", async () => {
        const viewer = await person(["sales.customer.view"]);
        const res = await h.call(CREATE, { body: { name: "Person A", phone: "01987654321" }, token: viewer });
        assert.equal(res.status, 403);
    });

    it("asks someone with no session to sign in", async () => {
        const res = await h.call(CREATE, { body: { name: "Person A", phone: "01987654321" } });
        assert.equal(res.status, 401);
    });

    it("saves an edit with what changed, and writes nothing for an untouched form", async () => {
        const oid = await create(token, { name: "Person A", phone: "01987654321" });
        const edit = { oid, name: "Person A", phone: "01987654321", gender: "Female", age_band: "25_34", status: "Active" };
        const saved = await h.call(UPDATE, { body: edit, token });
        assert.equal(saved.status, 200);
        assert.equal(saved.body.data.changed, true);
        const [row] = await h.query("SELECT gender, age_band FROM customers WHERE oid = $1", [oid]);
        assert.deepEqual(row, { gender: "Female", age_band: "25_34" });

        const again = await h.call(UPDATE, { body: edit, token });
        assert.equal(again.body.data.changed, false);
        const updates = await h.query("SELECT description FROM activity_log WHERE reference_oid = $1 AND title = 'Updated customer'", [oid]);
        assert.equal(updates.length, 1);
        assert.match(updates[0].description, /Gender/);
    });
});

describe("looking a customer up by phone", () => {
    let token;
    beforeEach(async () => {
        await h.reset();
        await seed_places();
        token = await person();
    });

    it("brings a known customer with their addresses, default first, from Bengali digits", async () => {
        const oid = await create(token, { name: "Person A", phone: "01987654321", address: home });
        await h.call(ADD_ADDRESS, { body: { customer_oid: oid, ...sister }, token });

        const res = await h.call(FIND, { body: { phone: "০১৯৮৭-৬৫৪৩২১" }, token });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.customer.oid, oid);
        assert.deepEqual(res.body.data.addresses.map((a) => [a.label, a.is_default, a.district_name_en]), [["Home", true, "Dhaka"], ["Sister", false, "Rajshahi"]]);
        assert.equal(res.body.data.history.orders, 0);
    });

    it("answers an unknown phone as a new customer, not an error", async () => {
        const res = await h.call(FIND, { body: { phone: "01700000000" }, token });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.customer, null);
    });

    it("opens to a counter salesperson who cannot see the customers list", async () => {
        const counter = await person(["sales.pos.view", "sales.pos.create"]);
        const res = await h.call(FIND, { body: { phone: "01700000000" }, token: counter });
        assert.equal(res.status, 200);
    });

    it("gives a counter salesperson a known customer's counter history only", async () => {
        const oid = await create(token, { name: "Person A", phone: "01987654321" });
        for (const channel of ["POS", "ONLINE"]) {
            await h.query("INSERT INTO orders (oid, invoice_no, total_amount, channel, status, customer_oid) VALUES ($1, $1, 0, $2, 'Pending', $3)", [uuidv4(), channel, oid]);
        }
        const counter = await person(["sales.pos.view", "sales.pos.create"]);
        const res = await h.call(FIND, { body: { phone: "01987654321" }, token: counter });
        assert.equal(res.body.data.history.orders, 1);
        assert.deepEqual(res.body.data.last_orders.map((o) => o.channel), ["POS"]);
    });
});

describe("a customer's addresses", () => {
    let token;
    let customer_oid;
    beforeEach(async () => {
        await h.reset();
        await seed_places();
        token = await person();
        customer_oid = await create(token, { name: "Person A", phone: "01987654321", address: home });
    });

    it("moves the default to a new address marked default, leaving one default", async () => {
        const res = await h.call(ADD_ADDRESS, { body: { customer_oid, ...sister, is_default: true }, token });
        assert.equal(res.status, 200);
        assert.deepEqual((await addresses_of(customer_oid)).map((a) => [a.label, a.is_default]), [["Home", false], ["Sister", true]]);
    });

    it("keeps the default when an edit unticks it, so a customer is never left without one", async () => {
        const [address] = await addresses_of(customer_oid);
        const res = await h.call(UPDATE_ADDRESS, { body: { oid: address.oid, ...home, address_line: "7 Gaznabi Road", is_default: false }, token });
        assert.equal(res.status, 200);
        const [after] = await h.query("SELECT address_line, is_default FROM customer_address WHERE oid = $1", [address.oid]);
        assert.deepEqual(after, { address_line: "7 Gaznabi Road", is_default: true });
    });

    it("hands the default to the newest remaining address when the default is removed", async () => {
        await h.call(ADD_ADDRESS, { body: { customer_oid, ...sister }, token });
        const [first] = await addresses_of(customer_oid);
        const res = await h.call(RETIRE_ADDRESS, { body: { oid: first.oid }, token });
        assert.equal(res.status, 200);
        assert.deepEqual((await addresses_of(customer_oid)).map((a) => [a.label, a.is_default, a.status]), [["Home", false, "Inactive"], ["Sister", true, "Active"]]);
    });

    it("refuses to edit or remove an address already removed", async () => {
        const [address] = await addresses_of(customer_oid);
        await h.call(RETIRE_ADDRESS, { body: { oid: address.oid }, token });
        const again = await h.call(RETIRE_ADDRESS, { body: { oid: address.oid }, token });
        assert.equal(again.status, 409);
        const edit = await h.call(UPDATE_ADDRESS, { body: { oid: address.oid, ...home }, token });
        assert.equal(edit.status, 409);
    });

    it("refuses a staff member without edit removing an address", async () => {
        const [address] = await addresses_of(customer_oid);
        const staff = await person(["sales.customer.view", "sales.customer.create"]);
        const res = await h.call(RETIRE_ADDRESS, { body: { oid: address.oid }, token: staff });
        assert.equal(res.status, 403);
    });
});

describe("flagging a customer", () => {
    let token;
    let oid;
    beforeEach(async () => {
        await h.reset();
        await seed_places();
        token = await person();
        oid = await create(token, { name: "Person A", phone: "01987654321" });
    });

    it("needs a reason to watch or block", async () => {
        const res = await h.call(FLAG, { body: { oid, flag: "Blocked" }, token });
        assert.equal(res.status, 400);
    });

    it("blocks with the reason and records who did it", async () => {
        const res = await h.call(FLAG, { body: { oid, flag: "Blocked", reason: "Refused three parcels" }, token });
        assert.equal(res.status, 200);
        const [row] = await h.query("SELECT flag, flag_reason FROM customers WHERE oid = $1", [oid]);
        assert.deepEqual(row, { flag: "Blocked", flag_reason: "Refused three parcels" });
        const [entry] = await h.query("SELECT title, description FROM activity_log WHERE reference_oid = $1 AND title LIKE 'Flagged%'", [oid]);
        assert.deepEqual(entry, { title: "Flagged Blocked", description: "Refused three parcels" });
    });
});

// A POS sale of two at 100 less 10 a unit with one returned, an online parcel of 500 plus 60
// delivery with a return still Pending, a Pending online order, a parcel that came back, a sale
// returned in full with its delivery refunded, and an order cancelled as fake.
const seed_history = async (customer_oid) => {
    await h.query("INSERT INTO categories (oid, name, category_code, status) VALUES ('C-1', 'Kurti', 'KUR', 'Active')");
    await h.query("INSERT INTO sub_categories (oid, name, category_code, category_oid, status) VALUES ('S-1', 'Printed', 'PRI', 'C-1', 'Active')");
    await h.query("INSERT INTO product (oid, name, category_oid, sub_category_oid) VALUES ('P-1', 'Floral Kurti', 'C-1', 'S-1')");
    await h.query("INSERT INTO inventory (oid, batch_code, product_oid, initial_quantity, quantity_available, cost_price, status) VALUES ('I-1', 'B-1', 'P-1', 10, 10, 50, 'ready_for_sale')");

    const order = async ({ channel, status, sold, delivery_charge = 0, lines = [], delivery_status = null }) => {
        const oid = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, total_amount, channel, status, customer_oid, sold_on, delivery_charge) VALUES ($1, $1, 0, $2, $3, $4, $5, $6)", [oid, channel, status, customer_oid, sold ? new Date() : null, delivery_charge]);
        if (channel === "ONLINE") await h.query("INSERT INTO online_order (order_oid, delivery_status) VALUES ($1, $2)", [oid, delivery_status]);
        const items = [];
        for (const line of lines) {
            const item = uuidv4();
            await h.query("INSERT INTO order_items (oid, order_oid, inventory_oid, product_oid, product_name, quantity, unit_price, discount, total) VALUES ($1, $2, 'I-1', 'P-1', 'Floral Kurti', $3, $4, $5, 0)", [item, oid, line.quantity, line.unit_price, line.discount]);
            items.push(item);
        }
        return { oid, items };
    };

    // As confirm-return leaves it: the return row, and returned_qty raised on the line.
    const returned = async (order, quantity, { status = "Returned", refund_delivery_charge = false } = {}) => {
        const return_oid = uuidv4();
        await h.query("INSERT INTO product_return (oid, order_oid, invoice_no, refund_amount, status, refund_delivery_charge) VALUES ($1, $2, $1, 0, $3, $4)", [return_oid, order.oid, status, refund_delivery_charge]);
        await h.query("INSERT INTO return_details (oid, return_oid, product_oid, inventory_oid, return_quantity, order_item_oid, condition) VALUES ($1, $2, 'P-1', 'I-1', $3, $4, 'Good')", [uuidv4(), return_oid, quantity, order.items[0]]);
        if (status === "Returned") await h.query("UPDATE order_items SET returned_qty = returned_qty + $1 WHERE oid = $2", [quantity, order.items[0]]);
    };

    await returned(await order({ channel: "POS", status: "PartiallyReturned", sold: true, lines: [{ quantity: 2, unit_price: 100, discount: 10 }] }), 1);
    await returned(await order({ channel: "ONLINE", status: "Delivered", sold: true, delivery_charge: 60, delivery_status: "Delivered", lines: [{ quantity: 1, unit_price: 500, discount: 0 }] }), 1, { status: "Pending", refund_delivery_charge: true });
    await order({ channel: "ONLINE", status: "Pending", sold: false, delivery_charge: 60, lines: [{ quantity: 3, unit_price: 500, discount: 0 }] });
    await order({ channel: "ONLINE", status: "Confirmed", sold: false, delivery_charge: 120, delivery_status: "Failed", lines: [{ quantity: 1, unit_price: 700, discount: 0 }] });
    await returned(await order({ channel: "ONLINE", status: "Returned", sold: true, delivery_charge: 80, delivery_status: "Delivered", lines: [{ quantity: 2, unit_price: 400, discount: 0 }] }), 2, { refund_delivery_charge: true });
    const fake = await order({ channel: "ONLINE", status: "Cancelled", sold: false, lines: [{ quantity: 1, unit_price: 300, discount: 0 }] });
    await h.query("UPDATE orders SET cancel_reason_code = 'fake_order' WHERE oid = $1", [fake.oid]);
    await order({ channel: "POS", status: "Draft", sold: false, lines: [{ quantity: 9, unit_price: 100, discount: 0 }] });
};

describe("a customer's record", () => {
    let customer_oid;
    beforeEach(async () => {
        await h.reset();
        await seed_places();
        await h.query("TRUNCATE categories CASCADE");
        customer_oid = await create(await person(), { name: "Person A", phone: "01987654321", address: home });
        await seed_history(customer_oid);
    });

    it("counts lifetime value from what the customer kept, never from orders that did not sell", async () => {
        const res = await h.call(`${DETAILS}/${customer_oid}`, { method: "GET", token: await person() });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.data.stats, {
            ...res.body.data.stats,
            orders: 6,
            sales: 2,
            lifetime_value: 90 + 500 + 60,
            average_order: 325,
            delivered: 2,
            refused_parcels: 1,
            delivered_rate: 66.7,
            cancelled_fake_or_unreachable: 1,
        });
        assert.equal(res.body.data.orders.length, 6);
        assert.equal(res.body.data.addresses.length, 1);
    });

    it("leaves an online order returned in full out of lifetime value, its kept delivery charge too, so the average purchase does not rise", async () => {
        const before = (await h.call(`${DETAILS}/${customer_oid}`, { method: "GET", token: await person() })).body.data.stats;
        const oid = uuidv4();
        await h.query("INSERT INTO orders (oid, invoice_no, total_amount, channel, status, customer_oid, sold_on, delivery_charge) VALUES ($1, $1, 0, 'ONLINE', 'Returned', $2, now(), 70)", [oid, customer_oid]);
        await h.query("INSERT INTO order_items (oid, order_oid, inventory_oid, product_oid, product_name, quantity, unit_price, discount, total, returned_qty) VALUES ($1, $2, 'I-1', 'P-1', 'Floral Kurti', 1, 600, 0, 600, 1)", [uuidv4(), oid]);
        await h.query("INSERT INTO product_return (oid, order_oid, invoice_no, refund_amount, status, refund_delivery_charge) VALUES ($1, $2, $1, 0, 'Returned', false)", [uuidv4(), oid]);

        const after = (await h.call(`${DETAILS}/${customer_oid}`, { method: "GET", token: await person() })).body.data.stats;
        assert.deepEqual([after.sales, after.lifetime_value, after.average_order], [before.sales, before.lifetime_value, before.average_order]);
    });

    it("tells the counter what the customer still owes, from unpaid and part paid sales they kept", async () => {
        const sale = async (payment_status, amount_paid, { status = "Purchased", quantity = 1, unit_price, discount = 0, sold = true }) => {
            const oid = uuidv4();
            await h.query("INSERT INTO orders (oid, invoice_no, total_amount, channel, status, customer_oid, sold_on, payment_status, amount_paid) VALUES ($1, $1, $2, 'POS', $3, $4, $5, $6, $7)", [oid, (unit_price - discount) * quantity, status, customer_oid, sold ? new Date() : null, payment_status, amount_paid]);
            const item = uuidv4();
            await h.query("INSERT INTO order_items (oid, order_oid, inventory_oid, product_oid, product_name, quantity, unit_price, discount, total) VALUES ($1, $2, 'I-1', 'P-1', 'Floral Kurti', $3, $4, $5, 0)", [item, oid, quantity, unit_price, discount]);
            return { oid, item };
        };
        await sale("unpaid", 0, { quantity: 2, unit_price: 100, discount: 10 });
        await sale("partially_paid", 200, { unit_price: 500 });
        // Paid 500 of 800, then one unit (400) came back and all of it was refunded out of the 500.
        const returned = await sale("partially_paid", 500, { status: "PartiallyReturned", quantity: 2, unit_price: 400 });
        await h.query("INSERT INTO product_return (oid, order_oid, invoice_no, refund_amount, status) VALUES ($1, $2, $1, 400, 'Returned')", [uuidv4(), returned.oid]);
        await h.query("UPDATE order_items SET returned_qty = 1 WHERE oid = $1", [returned.item]);
        await sale("paid", 0, { unit_price: 900 });
        await sale("unpaid", 0, { status: "Cancelled", unit_price: 700, sold: false });
        // Returned in full, but the return kept the delivery charge: the courier's 60 is still owed.
        const full = await sale("unpaid", 0, { status: "Returned", unit_price: 1000 });
        await h.query("UPDATE orders SET delivery_charge = 60 WHERE oid = $1", [full.oid]);
        await h.query("INSERT INTO product_return (oid, order_oid, invoice_no, refund_amount, status, refund_delivery_charge) VALUES ($1, $2, $1, 0, 'Returned', false)", [uuidv4(), full.oid]);
        await h.query("UPDATE order_items SET returned_qty = 1 WHERE oid = $1", [full.item]);

        const counter = await person(["sales.pos.view", "sales.pos.create"]);
        const res = await h.call(FIND, { body: { phone: "01987654321" }, token: counter });
        assert.equal(res.body.data.history.owed, 180 + 300 + 300 + 60);
    });

    it("never shows a counter-only salesperson a customer's saved addresses, on the record, the lookup or the list", async () => {
        const counter = await person(["sales.customer.view", "sales.pos.view", "sales.pos.create"]);
        const details = await h.call(`${DETAILS}/${customer_oid}`, { method: "GET", token: counter });
        assert.equal(details.body.data.addresses, null);
        const found = await h.call(FIND, { body: { phone: "01987654321" }, token: counter });
        assert.equal(found.body.data.addresses, null);
        const list = await h.call(`${LIST}?search=Person`, { method: "GET", token: counter });
        assert.equal(list.body.data.rows.length, 1);
        assert.equal("address_line" in list.body.data.rows[0], false);
        assert.equal("district_oid" in list.body.data.rows[0], false);

        const owner = await h.call(`${DETAILS}/${customer_oid}`, { method: "GET", token: await person() });
        assert.equal(owner.body.data.addresses.length, 1);
    });

    it("leaks no address to a counter-only salesperson through the activity, the district filter or an address write", async () => {
        const counter = await person(["sales.customer.view", "sales.customer.create", "sales.customer.edit", "sales.pos.view", "sales.pos.create"]);
        const details = await h.call(`${DETAILS}/${customer_oid}`, { method: "GET", token: counter });
        assert.equal(details.body.data.activity.some((entry) => /address/i.test(entry.action)), false);

        const unfiltered = await h.call(`${LIST}?search=Person`, { method: "GET", token: counter });
        const elsewhere = await h.call(`${LIST}?search=Person&district=${uuidv4()}`, { method: "GET", token: counter });
        assert.equal(elsewhere.body.total, unfiltered.body.total);

        const write = await h.call(ADD_ADDRESS, { body: { customer_oid, ...home }, token: counter });
        assert.equal(write.status, 403);
        const created = await h.call(CREATE, { body: { name: "Person C", phone: "01711000009", address: home }, token: counter });
        assert.equal(created.status, 403);
    });

    it("shows a counter salesperson only the counter orders and their value", async () => {
        const counter = await person(["sales.customer.view", "sales.pos.view"]);
        const res = await h.call(`${DETAILS}/${customer_oid}`, { method: "GET", token: counter });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.stats.orders, 1);
        assert.equal(res.body.data.stats.lifetime_value, 90);
        assert.equal(res.body.data.stats.delivered_rate, null);
        assert.deepEqual(res.body.data.orders.map((o) => o.channel), ["POS"]);
        assert.deepEqual(res.body.data.channels, ["POS"]);
    });

    it("answers 404 for a customer that does not exist", async () => {
        const res = await h.call(`${DETAILS}/${uuidv4()}`, { method: "GET", token: await person() });
        assert.equal(res.status, 404);
    });
});

describe("the customers list", () => {
    let token;
    beforeEach(async () => {
        await h.reset();
        await seed_places();
        token = await person();
        await create(token, { name: "Person A", phone: "01987654321", gender: "Female", address: home });
        await create(token, { name: "Person B", phone: "01811000000", address: sister });
        await create(token, { name: "Person C", phone: "01911000000", gender: "Male" });
    });

    const names = (res) => res.body.data.rows.map((r) => r.name);

    it("finds a customer by part of the phone", async () => {
        const res = await h.call(`${LIST}?search=98765`, { method: "GET", token });
        assert.equal(res.status, 200);
        assert.deepEqual(names(res), ["Person A"]);
    });

    it("filters by the default address's district and by gender not known", async () => {
        const rajshahi = await h.call(`${LIST}?district=BD-Rajshahi`, { method: "GET", token });
        assert.deepEqual(names(rajshahi), ["Person B"]);
        const unknown = await h.call(`${LIST}?gender=unknown`, { method: "GET", token });
        assert.deepEqual(names(unknown), ["Person B"]);
        const both = await h.call(`${LIST}?gender=Female,Male&include=stats`, { method: "GET", token });
        assert.deepEqual(names(both), ["Person A", "Person C"]);
        assert.equal(both.body.data.stats.active, 2);
    });

    it("downloads the filtered list for the owner and refuses staff without export", async () => {
        const res = await fetch(h.url() + `${EXPORT}?district=BD-Dhaka`, { headers: { authorization: `Bearer ${token}` } });
        assert.equal(res.status, 200);
        assert.match(res.headers.get("content-type"), /spreadsheetml/);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
        const names = [];
        workbook.getWorksheet("Customers").eachRow((row) => names.push(row.getCell(1).value));
        assert.ok(names.includes("Person A"));
        assert.ok(!names.includes("Person B") && !names.includes("Person C"));
        const staff = await person(["sales.customer.view"]);
        const refused = await h.call(`${EXPORT}`, { method: "GET", token: staff });
        assert.equal(refused.status, 403);
    });
});
