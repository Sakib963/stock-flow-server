// Fills a database with a year of a business that sells at a counter and online. Every receipt, sale,
// delivery, return, refund, adjustment and campaign goes through the app's own endpoints, in date
// order, so stock, holds, payments and refunds are exactly what the app itself would have written.
//
// The app stamps times with the database clock, so the run gives its own connections a clock of
// their own: seedclock.now() and seedclock.clock_timestamp() sit ahead of pg_catalog on their search
// path and read the moment of the event being played. Columns filled by a CURRENT_TIMESTAMP default
// still get the real time; they are moved onto the event's time as it finishes (orders.created_on,
// which numbers the day's invoices) or in one pass at the end (everything else).
//
//   DB_HOST=localhost DB_PORT=5433 DB_USER=postgres DB_PASSWORD= DB_NAME=stockflow_seed DB_SSL=false node tools/seed-dev-data.js
//
// It plays StockFlow's own made-up staff, signed in with the Manager and Staff roles, so it needs a
// database built from generated_schema.sql with those roles, the order sources and no orders yet.
const path = require("path");
const crypto = require("crypto");

process.env.ENV_FILE = process.env.ENV_FILE || path.resolve(__dirname, "../src/env/.env");
require("dotenv").config({ path: process.env.ENV_FILE });
process.env.PGOPTIONS = "-c search_path=seedclock,public,pg_catalog";
process.env.ACCESS_TOKEN_SECRET_EXPIRE = "24h";

const send_email_path = require.resolve("../src/email/send-email");
require.cache[send_email_path] = { id: send_email_path, filename: send_email_path, loaded: true, exports: async () => ({ messageId: "dev-seed" }) };

const { once } = require("events");
const { Client } = require("pg");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const { createPRNG } = require("./lib/prng");
const bank = require("./lib/seed-data-bank");

const DAY = 86400000;
const HOUR = 3600000;
const MINUTE = 60000;
const DHAKA = 6 * HOUR;

const local = ["localhost", "127.0.0.1"].includes(process.env.DB_HOST);
if (!local && !process.argv.includes("--cloud")) {
    console.error(`Refusing to seed ${process.env.DB_HOST}: run it on a local copy first, and pass --cloud only once the owner has approved the local result.`);
    process.exit(1);
}

const seed_arg = process.argv.find((a) => a.startsWith("--seed="));
const rng = createPRNG(seed_arg ? Number(seed_arg.split("=")[1]) : 20261021);
const days_arg = process.argv.find((a) => a.startsWith("--days="));
let DAYS = days_arg ? Number(days_arg.split("=")[1]) : 365;
const CATCH_UP = process.argv.includes("--catch-up");

const admin = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
    options: "-c search_path=public",
});
const read = async (text, values = []) => (await admin.query(text, values)).rows;

const STAFF = {
    manager: { name: "Tahmina Akter", designation: "Store manager", role: "Manager" },
    cashier_morning: { name: "Rakib Hasan", designation: "Cashier", role: "Staff" },
    cashier_evening: { name: "Sumaiya Islam", designation: "Cashier", role: "Staff" },
    moderator_a: { name: "Nafisa Rahman", designation: "Online moderator", role: "Staff" },
    moderator_b: { name: "Siam Ahmed", designation: "Online moderator", role: "Staff" },
    dispatch: { name: "Habib Uddin", designation: "Dispatch", role: "Staff" },
};
for (const person of Object.values(STAFF)) person.email = `${person.name.toLowerCase().replace(/\s+/g, ".")}@stockflow.com`;

let base;
const call = async (who, route, body) => {
    const res = await fetch(base + route, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${STAFF[who].token}` }, body: JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = { message: text };
    }
    return { status: res.status, body: json };
};

const failures = new Map();
const ok = async (who, route, body) => {
    const res = await call(who, route, body);
    if (res.status === 200) return res.body.data ?? {};
    const key = `${route} ${res.status}`;
    failures.set(key, (failures.get(key) || 0) + 1);
    if (failures.get(key) <= 3) console.warn(`  refused ${key}: ${res.body?.message}`);
    if ([...failures.values()].reduce((a, b) => a + b, 0) > 300) throw new Error("More than 300 refusals: the seed is out of step with the app. Stopping.");
    return null;
};

const { CONTEXTS: C, SUB_CONTEXTS: S, ROUTES: R } = require("../src/utils/constant");
const API = {
    category: C.CONFIGURATION + S.CATEGORY + R.CREATE_CATEGORY,
    sub_category: C.CONFIGURATION + S.SUB_CATEGORY + R.CREATE_SUB_CATEGORY,
    brand: C.CONFIGURATION + S.BRANDS + R.CREATE_BRANDS,
    supplier: C.CONFIGURATION + S.SUPPLIER + R.CREATE_SUPPLIER,
    warehouse: C.CONFIGURATION + S.WAREHOUSE + R.CREATE_WAREHOUSE,
    aisle: C.CONFIGURATION + S.AISLE + R.CREATE_AISLE,
    product: C.CONFIGURATION + S.PRODUCT + R.CREATE_PRODUCT,
    po_create: C.INVENTORY + S.PURCHASE_ORDER + R.CREATE_PURCHASE,
    po_verify: C.INVENTORY + S.PURCHASE_ORDER + R.VERIFY_PURCHASE,
    po_payment: C.INVENTORY + S.PURCHASE_ORDER + R.UPDATE_PURCHASE_PAYMENT,
    po_cancel: C.INVENTORY + S.PURCHASE_ORDER + R.CANCEL_PURCHASE,
    adjust_create: C.INVENTORY + S.STOCK_ADJUSTMENT + R.CREATE_STOCK_ADJUSTMENT,
    adjust_verify: C.INVENTORY + S.STOCK_ADJUSTMENT + R.VERIFY_STOCK_ADJUSTMENT,
    adjust_reject: C.INVENTORY + S.STOCK_ADJUSTMENT + R.REJECT_STOCK_ADJUSTMENT,
    dispose_create: C.INVENTORY + S.PRODUCT_DISPOSE + R.CREATE_PRODUCT_DISPOSE,
    dispose_approve: C.INVENTORY + S.PRODUCT_DISPOSE + R.APPROVE_PRODUCT_DISPOSE,
    dispose_reject: C.INVENTORY + S.PRODUCT_DISPOSE + R.REJECT_PRODUCT_DISPOSE,
    pos_checkout: C.SALES + S.POS + R.CHECKOUT_POS_SALE,
    online_create: C.SALES + S.ONLINE + R.CREATE_ONLINE_ORDER,
    order_confirm: C.SALES + S.ORDER + R.CONFIRM_ORDER,
    order_cancel: C.SALES + S.ORDER + R.CANCEL_ORDER,
    order_not_delivered: C.SALES + S.ORDER + R.MARK_ORDER_NOT_DELIVERED,
    order_refund: C.SALES + S.ORDER + R.RECORD_ORDER_REFUND,
    batch_create: C.SALES + S.DELIVERY_BATCH + R.CREATE_DELIVERY_BATCH,
    batch_hand_over: C.SALES + S.DELIVERY_BATCH + R.HAND_OVER_DELIVERY_BATCH,
    batch_deliver: C.SALES + S.DELIVERY_BATCH + R.DELIVER_DELIVERY_BATCH,
    return_create: C.SALES + S.RETURN + R.CREATE_RETURN,
    return_confirm: C.SALES + S.RETURN + R.CONFIRM_RETURN,
    return_cancel: C.SALES + S.RETURN + R.CANCEL_RETURN,
    pre_create: C.SALES + S.PRE_ORDER + R.CREATE_PRE_ORDER,
    pre_confirm: C.SALES + S.PRE_ORDER + R.CONFIRM_PRE_ORDER,
    pre_cancel: C.SALES + S.PRE_ORDER + R.CANCEL_PRE_ORDER,
    pre_refund: C.SALES + S.PRE_ORDER + R.RECORD_PRE_ORDER_REFUND,
    gift_create: C.SALES + S.GIVEAWAY + R.CREATE_GIVEAWAY,
    gift_give: C.SALES + S.GIVEAWAY + R.GIVE_GIVEAWAY,
    gift_cancel: C.SALES + S.GIVEAWAY + R.CANCEL_GIVEAWAY,
    partner: C.MARKETING + S.PARTNER + R.CREATE_PARTNER,
    campaign_create: C.MARKETING + S.CAMPAIGN + R.CREATE_CAMPAIGN,
    campaign_start: C.MARKETING + S.CAMPAIGN + R.START_CAMPAIGN,
    campaign_complete: C.MARKETING + S.CAMPAIGN + R.COMPLETE_CAMPAIGN,
    campaign_cancel: C.MARKETING + S.CAMPAIGN + R.CANCEL_CAMPAIGN,
    deliverable_create: C.MARKETING + S.CAMPAIGN + R.CREATE_CAMPAIGN_DELIVERABLE,
    deliverable_update: C.MARKETING + S.CAMPAIGN + R.UPDATE_CAMPAIGN_DELIVERABLE,
    partner_payment: C.MARKETING + S.PARTNER_PAYMENT + R.CREATE_PARTNER_PAYMENT,
};

const until_arg = process.argv.find((a) => a.startsWith("--until="));
const RUN_START = until_arg ? Date.parse(until_arg.split("=")[1]) : Date.now();
if (Number.isNaN(RUN_START) || RUN_START > Date.now()) {
    console.error("--until takes a moment in the past, such as --until=2026-10-01T12:00:00Z.");
    process.exit(1);
}
const END = RUN_START - 15 * MINUTE;
const midnight_of = (ms) => Math.floor((ms + DHAKA) / DAY) * DAY - DHAKA;
let DAY0 = midnight_of(RUN_START) - DAYS * DAY;
// A catch-up plays only after the last moment already in the database, and AGE is how many days the
// business had been trading at DAY0, so its growth and monthly rhythm carry on rather than restart.
let START = 0;
let AGE = 0;
const at = (day, hour, minute = 0) => DAY0 + day * DAY + hour * HOUR + minute * MINUTE;
const date_of = (ms) => new Date(ms + DHAKA).toISOString().slice(0, 10);
const day_of = (ms) => Math.floor((ms - DAY0) / DAY);

const queue = [];
let sequence = 0;
const push = (item) => {
    queue.push(item);
    let i = queue.length - 1;
    while (i > 0) {
        const parent = (i - 1) >> 1;
        if (before(queue[parent], queue[i])) break;
        [queue[parent], queue[i]] = [queue[i], queue[parent]];
        i = parent;
    }
};
const before = (a, b) => a.t < b.t || (a.t === b.t && a.seq < b.seq);
const pop = () => {
    const top = queue[0];
    const last = queue.pop();
    if (queue.length) {
        queue[0] = last;
        let i = 0;
        for (;;) {
            const l = 2 * i + 1;
            const r = l + 1;
            let m = i;
            if (l < queue.length && before(queue[l], queue[m])) m = l;
            if (r < queue.length && before(queue[r], queue[m])) m = r;
            if (m === i) break;
            [queue[m], queue[i]] = [queue[i], queue[m]];
            i = m;
        }
    }
    return top;
};
const schedule = (t, fn) => {
    if (t > START && t < END) push({ t, seq: sequence++, fn });
};

let clock_until = 0;
const play = async ({ t, fn }) => {
    const moment = Math.max(t, clock_until + 1000);
    await admin.query("UPDATE seedclock.clock SET real_start = pg_catalog.clock_timestamp(), virtual_start = to_timestamp($1::double precision / 1000)", [moment]);
    await admin.query("INSERT INTO seedclock.event (real_start, shift) SELECT real_start AT TIME ZONE 'UTC', virtual_start - real_start FROM seedclock.clock");
    const started = Date.now();
    await fn(moment);
    clock_until = moment + (Date.now() - started);
    await admin.query(`UPDATE orders o SET created_on = o.created_on + (c.virtual_start - c.real_start) FROM seedclock.clock c WHERE o.created_on >= (c.real_start AT TIME ZONE 'UTC')`);
};

const products = [];
const product_by_oid = new Map();
const batches = new Map();
const batches_of = new Map();
const customers = [];
const known_phones = new Set();
let districts = [];
let thanas_of = new Map();
let dhaka_oid = null;
const sources = [];

const resync_stock = async (product_oids = null) => {
    const rows = await read(
        `SELECT i.oid, i.product_oid, i.batch_code, i.selling_price::int AS price, COALESCE(i.maximum_discount, 0)::int AS max_discount, i.expiry_date, i.cost_price::int AS cost,
                (i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM stock_hold h WHERE h.inventory_oid = i.oid AND h.status = 'Active'), 0))::int AS sellable,
                i.quantity_available::int AS on_hand
           FROM inventory i
          WHERE i.product_oid = ANY($1) AND i.intended_use = 'for_sale' AND i.status = 'ready_for_sale' AND i.selling_price IS NOT NULL
          ORDER BY i.created_on, i.oid`,
        [product_oids ?? products.map((p) => p.oid)]
    );
    for (const oid of product_oids ?? products.map((p) => p.oid)) {
        for (const b of batches_of.get(oid) ?? []) batches.delete(b.oid);
        batches_of.set(oid, []);
    }
    for (const b of rows) {
        batches.set(b.oid, b);
        batches_of.get(b.product_oid).push(b);
    }
    for (const list of batches_of.values()) list.sort((a, b) => (a.expiry_date && b.expiry_date ? String(a.expiry_date).localeCompare(String(b.expiry_date)) : 0));
};

const sellable_of = (product_oid, t) => (batches_of.get(product_oid) ?? []).filter((b) => b.sellable > 0 && (!b.expiry_date || String(b.expiry_date) > date_of(t)));
const units_of = (product_oid, t) => sellable_of(product_oid, t).reduce((s, b) => s + b.sellable, 0);

const pick_product = (t, pool = products) => {
    const candidates = pool.filter((p) => !p.packaging && units_of(p.oid, t) > 0);
    if (!candidates.length) return null;
    return rng.pickWeighted(candidates, candidates.map((p) => p.weight));
};

// A cart: a few products, each from its oldest sellable batch, with the odd discount within the batch's limit.
const fill_cart = (t, { max_lines, quantities = [1, 2, 3], quantity_weights = [85, 12, 3], discount_chance = 0.25 }) => {
    const lines = [];
    const wanted = rng.pickWeighted([1, 2, 3, 4].slice(0, max_lines), [55, 27, 12, 6].slice(0, max_lines));
    for (let i = 0; i < wanted * 3 && lines.length < wanted; i++) {
        const product = pick_product(t);
        if (!product || lines.some((l) => l.product_oid === product.oid)) continue;
        const batch = sellable_of(product.oid, t)[0];
        const quantity = Math.min(batch.sellable, rng.pickWeighted(quantities, quantity_weights));
        const discount = rng.chance(discount_chance) && batch.max_discount >= 10 ? Math.min(batch.max_discount, Math.round((batch.price * rng.float(0.03, 0.12)) / 10) * 10) : 0;
        lines.push({ inventory_oid: batch.oid, product_oid: product.oid, quantity, discount, price: batch.price });
    }
    return lines;
};
const cart_total = (lines) => lines.reduce((s, l) => s + (l.price - l.discount) * l.quantity, 0);
const take = (lines, sign = -1) => {
    for (const l of lines) {
        const b = batches.get(l.inventory_oid);
        if (b) b.sellable += sign * l.quantity;
    }
};

const new_phone = () => {
    for (;;) {
        const phone = `017${String(rng.int(10000000, 99999999))}`;
        if (!known_phones.has(phone)) {
            known_phones.add(phone);
            return phone;
        }
    }
};

const new_home = () => {
    const district = rng.chance(0.45) ? districts.find((d) => d.oid === dhaka_oid) : rng.pick(districts);
    const thana = rng.pick(thanas_of.get(district.oid));
    return { district, thana, address_line: `${rng.pick(bank.STREET_PREFIXES)}, ${thana.name_en}`, address_oid: null };
};

const new_customer = () => {
    const female = rng.chance(0.58);
    const name = `${rng.pick(female ? bank.FEMALE_FIRST_NAMES : bank.MALE_FIRST_NAMES)} ${rng.pick(bank.LAST_NAMES)}`;
    const described = rng.chance(0.6);
    return {
        phone: new_phone(),
        name,
        gender: described ? (female ? "Female" : "Male") : null,
        age_band: described ? rng.pickWeighted(["18_24", "25_34", "35_44", "45_plus"], [30, 40, 20, 10]) : null,
        ...new_home(),
        orders: 0,
    };
};

const delivery_charge_of = (customer) => (customer.district.oid === dhaka_oid ? 70 : 130);

const FESTIVALS = [
    { from: "2025-11-25", to: "2026-01-05", lift: 1.2 },
    { from: "2026-02-28", to: "2026-03-20", lift: 1.9 },
    { from: "2026-05-12", to: "2026-05-26", lift: 1.35 },
    { from: "2026-09-25", to: "2026-10-20", lift: 1.3 },
];
const demand = (day) => {
    const t = at(day, 12);
    const date = date_of(t);
    const weekday = new Date(t + DHAKA).getUTCDay();
    const weekend = weekday === 5 ? 1.3 : weekday === 6 ? 1.15 : 1;
    const festival = FESTIVALS.find((f) => date >= f.from && date <= f.to)?.lift ?? 1;
    return weekend * festival;
};

// Purchasing: the manager reorders what runs low, from the product's supplier, and the goods are
// received a few days later (weeks, from abroad).
const open_po_units = new Map();
const SUPPLIERS_BY_CATEGORY = { CLOTH: [0, 1, 17], SKIN: [2, 3], BAGS: [4, 5], FOOT: [6], JEWEL: [7, 18], BABY: [8], HOME: [9], KITCH: [10], TECH: [11], PERF: [12], STAT: [13], PACK: [14, 15] };
const OVERSEAS = new Set([3, 11]);
const suppliers = [];
const purchase_orders = [];

const create_po = async (t, lines, supplier_index, { packaging = false } = {}) => {
    const supplier = suppliers[supplier_index];
    const overseas = OVERSEAS.has(supplier_index);
    const total = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
    const payment_status = rng.pickWeighted(["paid", "partially_paid", "unpaid"], [30, 40, 30]);
    const paid_amount = payment_status === "paid" ? total : payment_status === "partially_paid" ? Math.round((total * rng.float(0.3, 0.7)) / 100) * 100 : 0;
    const lead = overseas ? rng.int(12, 20) : rng.int(2, 6);
    const created = await ok("manager", API.po_create, {
        supplier_oid: supplier.oid,
        purchase_type: overseas ? "overseas" : rng.chance(0.15) ? "advance" : "instant",
        expected_delivery_date: date_of(t + lead * DAY),
        payment_status,
        paid_amount,
        products: lines.map((l) => ({ product_oid: l.product.oid, warehouse_oid: l.product.warehouse_oid, aisle_oid: l.product.aisle_oid, quantity: l.quantity, unit_price: l.unit_price })),
    });
    if (!created) return;
    for (const l of lines) open_po_units.set(l.product.oid, (open_po_units.get(l.product.oid) || 0) + l.quantity);
    const po = { oid: created.oid, lines, payment_status, packaging };
    purchase_orders.push(po);

    if (!packaging && rng.chance(0.03)) {
        schedule(t + rng.int(4, 30) * HOUR, async () => {
            if (await ok("manager", API.po_cancel, { oid: po.oid, reason: rng.pick(["Supplier could not ship this lot", "Ordered by mistake, a second order covers it", "Price changed after the order"]) })) release_po(po);
        });
        return;
    }
    const arrive = Math.max(day_of(t) + 1, day_of(t) + lead + rng.int(-1, 2));
    schedule(at(arrive, rng.int(11, 16), rng.int(0, 59)), (moment) => verify_po(moment, po));
};

const release_po = (po) => {
    for (const l of po.lines) open_po_units.set(l.product.oid, Math.max(0, (open_po_units.get(l.product.oid) || 0) - l.quantity));
};

const verify_po = async (t, po) => {
    const details = await read("SELECT oid, product_oid, ordered_quantity::int AS ordered_quantity, ordered_unit_price::int AS unit_price FROM purchase_details WHERE purchase_oid = $1", [po.oid]);
    const lines = details.map((d) => {
        const product = product_by_oid.get(d.product_oid);
        const short = rng.chance(0.08);
        const received = short ? Math.max(1, d.ordered_quantity - rng.int(1, Math.max(1, Math.floor(d.ordered_quantity * 0.2)))) : d.ordered_quantity;
        if (po.packaging) return { oid: d.oid, received_quantity: received, unit_price: d.unit_price, intended_use: "internal_use" };
        const price = Math.round((product.price * rng.float(1, 1 + 0.08 * (Math.min(365, AGE + day_of(t)) / 365))) / 10) * 10;
        const expiry = product.has_expiry ? date_of(t + (rng.chance(0.12) ? rng.int(25, 70) : rng.int(150, 540)) * DAY) : null;
        return { oid: d.oid, received_quantity: received, unit_price: d.unit_price, intended_use: "for_sale", selling_price: price, maximum_discount: Math.round((price * rng.float(0.08, 0.15)) / 10) * 10, expiry_date: expiry };
    });
    const done = await ok("manager", API.po_verify, { oid: po.oid, lines });
    release_po(po);
    if (!done) return;
    if (!po.packaging) await resync_stock(details.map((d) => d.product_oid));
    if (po.payment_status !== "paid" && rng.chance(0.9)) {
        schedule(t + rng.int(7, 45) * DAY, async () => {
            const [row] = await read("SELECT total_amount::int AS total FROM purchase WHERE oid = $1", [po.oid]);
            await ok("manager", API.po_payment, { oid: po.oid, payment_status: "paid", paid_amount: row.total });
        });
    }
};

const restock = async (t) => {
    const day = day_of(t);
    const by_supplier = new Map();
    for (const product of products) {
        if (product.packaging || (product.discontinued_from !== null && day >= product.discontinued_from)) continue;
        const have = (batches_of.get(product.oid) ?? []).reduce((s, b) => s + Math.max(0, b.sellable), 0) + (open_po_units.get(product.oid) || 0);
        const lead = OVERSEAS.has(product.supplier_index) ? 20 : 8;
        const reorder_at = Math.max(product.restock_threshold, Math.ceil(product.velocity * (lead + 7)));
        if (have > reorder_at) continue;
        const quantity = Math.min(9999, Math.max(12, Math.round((product.velocity * rng.int(60, 90)) / 5) * 5));
        if (!by_supplier.has(product.supplier_index)) by_supplier.set(product.supplier_index, []);
        by_supplier.get(product.supplier_index).push({ product, quantity, unit_price: product.cost });
    }
    for (const [supplier_index, lines] of by_supplier) {
        for (let i = 0; i < lines.length; i += 25) await create_po(t, lines.slice(i, i + 25), supplier_index);
    }
};

const restock_packaging = async (t) => {
    const lines = products.filter((p) => p.packaging).map((product) => ({ product, quantity: rng.int(20, 60) * 10, unit_price: product.cost }));
    const by_supplier = new Map();
    for (const l of lines) {
        if (!by_supplier.has(l.product.supplier_index)) by_supplier.set(l.product.supplier_index, []);
        by_supplier.get(l.product.supplier_index).push(l);
    }
    for (const [supplier_index, group] of by_supplier) await create_po(t, group, supplier_index, { packaging: true });
};

const pos_sales = [];

const pos_sale = async (t) => {
    const lines = fill_cart(t, { max_lines: 4 });
    if (!lines.length) return;
    const total = cart_total(lines);
    const who = new Date(t + DHAKA).getUTCHours() < 15 ? "cashier_morning" : "cashier_evening";
    const regular = customers.length > 50 && rng.chance(0.7);
    const customer = rng.chance(0.45) ? (regular ? rng.pick(customers) : new_customer()) : null;
    const payment_status = customer ? rng.pickWeighted(["paid", "partially_paid", "unpaid"], [95, 3, 2]) : "paid";
    if (payment_status === "partially_paid" && total < 100) return;
    const oid = uuidv4();
    const sale = await ok(who, API.pos_checkout, {
        oid,
        customer: customer ? { phone: customer.phone, name: customer.name } : undefined,
        payment_method: rng.pickWeighted(["cash", "bkash", "nagad", "card"], [60, 25, 7, 8]),
        payment_status,
        amount_paid: payment_status === "partially_paid" ? Math.round((total * rng.float(0.4, 0.8)) / 10) * 10 || 1 : undefined,
        total_amount: total,
        lines: lines.map(({ inventory_oid, quantity, discount }) => ({ inventory_oid, quantity, discount })),
    });
    if (!sale) return resync_stock(lines.map((l) => l.product_oid));
    take(lines);
    if (customer && !customers.includes(customer)) customers.push(customer);
    if (rng.chance(0.02)) schedule(t + rng.int(2, 168) * HOUR, (moment) => pos_return(moment, oid, who));
};

const pos_return = async (t, order_oid, who) => {
    const items = await read("SELECT oid, product_oid, (quantity - returned_qty)::int AS left FROM order_items WHERE order_oid = $1 AND quantity > returned_qty", [order_oid]);
    if (!items.length) return;
    const item = rng.pick(items);
    const condition = rng.chance(0.85) ? "Good" : "Damaged";
    const raised = await ok(who, API.return_create, {
        oid: uuidv4(),
        order_oid,
        return_reason: condition === "Damaged" ? "damaged_on_arrival" : rng.pick(["size_or_fit", "changed_mind", "wrong_item", "not_as_described"]),
        items: [{ order_item_oid: item.oid, quantity: rng.int(1, item.left), condition }],
    });
    if (!raised) return;
    const confirmed = await ok("manager", API.return_confirm, { oid: raised.return_oid, refund_method: rng.pickWeighted(["cash", "bkash"], [80, 20]) });
    if (confirmed) await resync_stock([item.product_oid]);
};

// Online: placed from a chat, confirmed, packed into the day's delivery batch per courier, handed
// over, then delivered or sent back.
const ready = new Map();
const with_courier = new Map();

const online_order = async (t, { pre_order = null } = {}) => {
    const who = rng.pick(["moderator_a", "moderator_b"]);
    const repeat = !pre_order && customers.length > 80 && rng.chance(0.55);
    const customer = pre_order ? pre_order.customer : repeat ? rng.pick(customers) : new_customer();

    let lines;
    if (pre_order) {
        lines = [];
        for (const booked of pre_order.lines) {
            let need = booked.quantity;
            for (const b of sellable_of(booked.product_oid, t)) {
                if (!need) break;
                const quantity = Math.min(need, b.sellable);
                lines.push({ inventory_oid: b.oid, product_oid: booked.product_oid, quantity, discount: 0, price: b.price });
                need -= quantity;
            }
            if (need) return false;
        }
    } else {
        lines = fill_cart(t, { max_lines: 3, quantities: [1, 2], quantity_weights: [88, 12], discount_chance: 0.15 });
    }
    if (!lines.length) return false;

    const delivery_charge = delivery_charge_of(customer);
    const total = cart_total(lines) + delivery_charge;
    const advance = pre_order ? pre_order.advance : 0;
    const payment_type = pre_order ? (advance === 0 ? "COD" : advance >= total ? "PREPAID" : "ADVANCE") : rng.pickWeighted(["COD", "ADVANCE", "PREPAID"], [72, 18, 10]);
    if (pre_order && advance > total) return false;
    const amount_paid = payment_type === "ADVANCE" ? (pre_order ? advance : Math.min(total - 1, rng.pick([delivery_charge, 200, 300, 500]))) : undefined;
    const address = customer.address_oid
        ? { oid: customer.address_oid }
        : { recipient_name: customer.name, recipient_phone: customer.phone, address_line: customer.address_line, district_oid: customer.district.oid, thana_oid: customer.thana.oid, is_default: true, label: "Home" };
    const oid = uuidv4();
    const order = await ok(who, API.online_create, {
        oid,
        customer: { phone: customer.phone, name: customer.name, gender: customer.gender, age_band: customer.age_band },
        address,
        source_oid: rng.pickWeighted(sources, sources.map((s) => s.weight)).oid,
        payment_type,
        payment_method: payment_type === "COD" ? undefined : rng.pickWeighted(["bkash", "nagad", "card"], [70, 20, 10]),
        amount_paid,
        delivery_charge,
        total_amount: total,
        lines: lines.map(({ inventory_oid, quantity, discount }) => ({ inventory_oid, quantity, discount })),
        pre_order_oid: pre_order?.oid,
    });
    if (!order) {
        await resync_stock(lines.map((l) => l.product_oid));
        return false;
    }
    take(lines);
    if (!customer.address_oid) customer.address_oid = (await read("SELECT customer_address_oid FROM online_order WHERE order_oid = $1", [oid]))[0]?.customer_address_oid ?? null;
    if (!customers.includes(customer)) customers.push(customer);
    const record = { oid, who, customer, lines, payment_type, prepaid: payment_type !== "COD" };

    if (!pre_order && rng.chance(0.04)) {
        schedule(t + rng.int(1, 6) * HOUR, (moment) => cancel_order(moment, record, rng.pick(["unreachable", "fake_order", "changed_mind", "duplicate"])));
        return true;
    }
    const morning = Math.max(t + 30 * MINUTE, at(day_of(t + 3 * HOUR), 10) + rng.int(0, 180) * MINUTE);
    const confirm_at = new Date(t + DHAKA).getUTCHours() >= 21 ? morning : t + rng.int(20, 300) * MINUTE;
    schedule(confirm_at, (moment) => confirm_order(moment, record));
    return true;
};

const confirm_order = async (t, record) => {
    const confirmed = await ok(record.who, API.order_confirm, { oid: record.oid, confirmed_via: record.payment_type === "COD" ? rng.pickWeighted(["PhoneCall", "Message", "NotNeeded"], [60, 30, 10]) : "AdvanceReceived" });
    if (!confirmed) return;
    if (rng.chance(0.03)) {
        schedule(t + rng.int(1, 5) * HOUR, (moment) => cancel_order(moment, record, rng.pick(["changed_mind", "price", "ordered_elsewhere", "unreachable"])));
        return;
    }
    get_ready(record);
};

const get_ready = (record) => {
    record.courier = record.customer.district.oid === dhaka_oid ? rng.pickWeighted(["Pathao", "Steadfast", "OwnRider", "RedX"], [45, 30, 15, 10]) : rng.pickWeighted(["Steadfast", "Pathao", "RedX", "Sundarban"], [50, 25, 15, 10]);
    ready.set(record.oid, record);
};

const cancel_order = async (t, record, reason_code) => {
    ready.delete(record.oid);
    const cancelled = await ok(record.who, API.order_cancel, { oid: record.oid, reason_code });
    if (!cancelled) return;
    take(record.lines, +1);
    if (record.prepaid) schedule(t + rng.int(2, 48) * HOUR, () => refund(record));
};

const refund = async (record) => {
    const [row] = await read("SELECT refund_due::int AS due, refund_status FROM orders WHERE oid = $1", [record.oid]);
    if (row?.refund_status !== "ToRefund" || row.due <= 0) return;
    await ok("dispatch", API.order_refund, { oid: record.oid, amount: row.due, method: rng.pickWeighted(["bkash", "nagad", "cash"], [70, 20, 10]) });
};

const send_batches = async (t) => {
    const by_courier = new Map();
    for (const record of ready.values()) {
        if (!by_courier.has(record.courier)) by_courier.set(record.courier, []);
        by_courier.get(record.courier).push(record);
    }
    ready.clear();
    for (const [courier, records] of by_courier) {
        for (let i = 0; i < records.length; i += 120) {
            const group = records.slice(i, i + 120);
            const oid = uuidv4();
            if (!(await ok("dispatch", API.batch_create, { oid, courier, order_oids: group.map((r) => r.oid) }))) continue;
            schedule(t + rng.int(50, 80) * MINUTE, (moment) => hand_over(moment, oid, group));
        }
    }
};

const hand_over = async (t, batch_oid, records) => {
    if (await ok("dispatch", API.batch_hand_over, { oid: batch_oid })) on_the_road(t, batch_oid, records);
};

const on_the_road = (t, batch_oid, records) => {
    const settle = new Map();
    for (const record of records) {
        with_courier.set(record.oid, record);
        const days = record.customer.district.oid === dhaka_oid ? rng.int(1, 2) : rng.int(2, 4);
        const failed = rng.chance(0.07);
        const day = day_of(t) + days;
        if (failed) {
            schedule(at(day, rng.int(12, 19), rng.int(0, 59)), (moment) => not_delivered(moment, record));
            continue;
        }
        if (!settle.has(day)) settle.set(day, []);
        settle.get(day).push(record);
    }
    for (const [day, group] of settle) schedule(at(day, rng.int(16, 21), rng.int(0, 59)), (moment) => deliver(moment, batch_oid, group));
};

const deliver = async (t, batch_oid, records) => {
    const done = await ok("dispatch", API.batch_deliver, { oid: batch_oid, order_oids: records.map((r) => r.oid) });
    if (!done) return;
    for (const record of records) {
        with_courier.delete(record.oid);
        if (rng.chance(0.045)) schedule(t + rng.int(1, 9) * DAY + rng.int(0, 8) * HOUR, (moment) => online_return(moment, record));
    }
};

const not_delivered = async (t, record) => {
    const reason = rng.pickWeighted(["refused", "unreachable", "wrong_address", "other"], [50, 30, 15, 5]);
    const raised = await ok("dispatch", API.order_not_delivered, { oid: record.oid, reason, note: reason === "other" ? "Courier says the area was flooded and the parcel could not reach" : undefined });
    with_courier.delete(record.oid);
    if (raised) schedule(t + rng.int(2, 5) * DAY, () => back_in_shop(raised.return_oid, record));
};

const back_in_shop = async (return_oid, record) => {
    const conditions = (await read("SELECT oid FROM return_details WHERE return_oid = $1", [return_oid])).map((d) => ({ oid: d.oid, condition: rng.chance(0.95) ? "Good" : "Damaged" }));
    if (!(await ok("dispatch", API.return_confirm, { oid: return_oid, conditions }))) return;
    await resync_stock(record.lines.map((l) => l.product_oid));
    if (record.prepaid) schedule(clock_until + rng.int(4, 72) * HOUR, () => refund(record));
};

const online_return = async (t, record) => {
    const items = await read("SELECT oid, product_oid, (quantity - returned_qty)::int AS left FROM order_items WHERE order_oid = $1 AND quantity > returned_qty", [record.oid]);
    if (!items.length) return;
    const everything = rng.chance(0.4);
    const chosen = everything ? items : [rng.pick(items)];
    const damaged = rng.chance(0.25);
    const raised = await ok(record.who, API.return_create, {
        oid: uuidv4(),
        order_oid: record.oid,
        return_reason: damaged ? "damaged_on_arrival" : rng.pickWeighted(["size_or_fit", "changed_mind", "wrong_item", "not_as_described"], [40, 25, 15, 20]),
        refund_delivery_charge: everything && rng.chance(0.3),
        items: chosen.map((i) => ({ order_item_oid: i.oid, quantity: everything ? i.left : rng.int(1, i.left), condition: damaged ? "Damaged" : "Good" })),
    });
    if (!raised) return;
    if (rng.chance(0.06)) {
        schedule(t + rng.int(1, 3) * DAY, () => ok(record.who, API.return_cancel, { oid: raised.return_oid, reason: rng.pick(["Customer kept the item after all", "Entered against the wrong order"]) }));
        return;
    }
    schedule(t + rng.int(2, 6) * DAY, async () => {
        if (!(await ok("dispatch", API.return_confirm, { oid: raised.return_oid }))) return;
        await resync_stock(chosen.map((i) => i.product_oid));
        schedule(clock_until + rng.int(4, 72) * HOUR, () => refund(record));
    });
};

const pre_order = async (t) => {
    const out = products.filter((p) => !p.packaging && units_of(p.oid, t) === 0 && (p.discontinued_from === null || day_of(t) < p.discontinued_from));
    const product = out.length ? rng.pick(out) : rng.pick(products.filter((p) => !p.packaging));
    const customer = customers.length > 50 && rng.chance(0.3) ? rng.pick(customers) : new_customer();
    const quantity = rng.pickWeighted([1, 2], [85, 15]);
    const unit_price = product.price;
    const advance = rng.chance(0.7) ? Math.min(unit_price * quantity, rng.pick([200, 300, 500, 1000])) : 0;
    const oid = uuidv4();
    const who = rng.pick(["moderator_a", "moderator_b"]);
    const created = await ok(who, API.pre_create, {
        oid,
        customer: { phone: customer.phone, name: customer.name },
        lines: [{ product_oid: product.oid, quantity, unit_price }],
        advance_paid: advance,
        advance_method: advance ? rng.pickWeighted(["bkash", "nagad", "cash"], [70, 20, 10]) : undefined,
        expected_date: date_of(t + rng.int(7, 21) * DAY),
    });
    if (!created) return;
    if (!customers.includes(customer)) customers.push(customer);
    const booking = { oid, who, customer, advance, lines: [{ product_oid: product.oid, quantity }], tries: 0 };
    if (rng.chance(0.85)) schedule(t + rng.int(2, 30) * HOUR, () => ok(who, API.pre_confirm, { oid }));
    if (rng.chance(0.1)) {
        schedule(t + rng.int(2, 10) * DAY, (moment) => cancel_pre_order(moment, booking, "changed_mind"));
        return;
    }
    if (product.discontinued_from === null && (open_po_units.get(product.oid) || 0) === 0 && units_of(product.oid, t) === 0) await restock_one(t, product);
    schedule(t + rng.int(5, 12) * DAY, (moment) => convert_pre_order(moment, booking));
};

const restock_one = (t, product) => create_po(t, [{ product, quantity: Math.max(12, Math.round(product.velocity * 40)), unit_price: product.cost }], product.supplier_index);

const convert_pre_order = async (t, booking) => {
    const [row] = await read("SELECT status FROM pre_orders WHERE oid = $1", [booking.oid]);
    if (!["Pending", "Confirmed"].includes(row?.status)) return;
    if (await online_order(t, { pre_order: booking })) return;
    booking.tries += 1;
    if (booking.tries < 6) schedule(t + rng.int(3, 6) * DAY, (moment) => convert_pre_order(moment, booking));
    else await cancel_pre_order(t, booking, "stock_not_coming");
};

const cancel_pre_order = async (t, booking, reason) => {
    const cancelled = await ok(booking.who, API.pre_cancel, { oid: booking.oid, reason, refund_due: booking.advance });
    if (cancelled && booking.advance > 0) schedule(t + rng.int(1, 3) * DAY, () => ok("manager", API.pre_refund, { oid: booking.oid }));
};

const adjustment = async (t) => {
    const product = pick_product(t);
    if (!product) return;
    const batch = sellable_of(product.oid, t)[0];
    const reason = rng.pickWeighted(["found", "lost", "theft", "entry_error"], [35, 35, 10, 20]);
    const direction = reason === "found" ? "in" : reason === "entry_error" ? rng.pick(["in", "out"]) : "out";
    const quantity = Math.min(direction === "out" ? batch.sellable : 9999, rng.int(1, 3));
    if (!quantity) return;
    const created = await ok("manager", API.adjust_create, {
        reason,
        note: { found: "Found during the monthly count", lost: "Missing at the monthly count", theft: "Missing from the display shelf", entry_error: "Correcting a count entered wrong" }[reason],
        lines: [{ product_oid: product.oid, direction, quantity, inventory_oid: batch.oid }],
    });
    if (!created) return;
    schedule(t + rng.int(2, 30) * HOUR, async () => {
        if (rng.chance(0.06)) return ok("manager", API.adjust_reject, { oid: created.oid, reason: "Recounted, the shelf matches the system" });
        if (await ok("manager", API.adjust_verify, { oid: created.oid })) await resync_stock([product.oid]);
    });
};

const disposal = async (t) => {
    const expired = [...batches.values()].filter((b) => b.expiry_date && String(b.expiry_date) <= date_of(t + 3 * DAY) && b.sellable > 0);
    const batch = expired.length && rng.chance(0.6) ? rng.pick(expired) : sellable_of(pick_product(t)?.oid, t)[0];
    if (!batch) return;
    const reason = batch.expiry_date && String(batch.expiry_date) <= date_of(t + 3 * DAY) ? "expired" : rng.pickWeighted(["damaged", "spoiled", "quality_reject"], [70, 15, 15]);
    const quantity = reason === "expired" ? batch.sellable : Math.min(batch.sellable, rng.int(1, 3));
    const created = await ok("manager", API.dispose_create, {
        method: reason === "expired" ? "destroyed" : rng.pick(["discarded", "destroyed", "recycled"]),
        note: reason === "expired" ? "Past its expiry date" : "Found damaged in the store",
        lines: [{ product_oid: batch.product_oid, inventory_oid: batch.oid, quantity, reason }],
    });
    if (!created) return;
    schedule(t + rng.int(2, 30) * HOUR, async () => {
        if (rng.chance(0.06)) return ok("manager", API.dispose_reject, { oid: created.oid, reason: "These can be sold at a discount instead" });
        if (await ok("manager", API.dispose_approve, { oid: created.oid })) await resync_stock([batch.product_oid]);
    });
};

const goodwill_gift = async (t) => {
    const product = pick_product(t);
    const customer = customers.length ? rng.pick(customers) : null;
    if (!product || !customer) return;
    const batch = sellable_of(product.oid, t)[0];
    const oid = uuidv4();
    const created = await ok("manager", API.gift_create, {
        oid,
        recipient_name: customer.name,
        recipient_phone: customer.phone,
        address_line: customer.address_line,
        note: rng.pick(["Sorry for the late delivery", "Thank you for shopping with us for a year", "Winner of the page giveaway", "Replacement goodwill for a damaged parcel"]),
        lines: [{ inventory_oid: batch.oid, quantity: 1 }],
    });
    if (!created) return;
    schedule(t + rng.int(1, 30) * HOUR, async () => {
        if (rng.chance(0.05)) return ok("manager", API.gift_cancel, { oid, reason: "The customer could not be reached" });
        if (await ok("manager", API.gift_give, { oid })) await resync_stock([product.oid]);
    });
};

const partners = [];

const campaign = async (t, plan) => {
    const start = at(DAYS - plan.startDaysAgo, 10);
    const end = at(DAYS - plan.endDaysAgo, 22);
    const in_stock = products.filter((p) => !p.packaging && units_of(p.oid, t) > 5);
    const chosen = rng.shuffle(in_stock).slice(0, rng.int(2, 4));
    if (!chosen.length) return;
    const with_partners = plan.type !== "BoostedAd";
    const team = with_partners ? rng.shuffle(partners).slice(0, rng.int(1, 3)) : [];
    const oid = uuidv4();
    const created = await ok("manager", API.campaign_create, {
        oid,
        name: plan.name,
        promotion_type: plan.type,
        posting_start: date_of(start),
        posting_end: date_of(end),
        measure_end: date_of(end + 14 * DAY),
        ad_spend: plan.spend || null,
        batches: chosen.map((p) => sellable_of(p.oid, t)[0].oid),
        partners: team.map((p) => ({ partner_oid: p.oid, agreed_fee: rng.pick([5000, 8000, 10000, 15000, 20000, 30000]) })),
    });
    if (!created) return;
    if (plan.status === "Cancelled") {
        schedule(start - 2 * DAY, () => ok("manager", API.campaign_cancel, { oid, note: "The partners could not post in the agreed week" }));
        return;
    }
    const lines = await read("SELECT oid, partner_oid, agreed_fee::int AS fee FROM campaign_partner WHERE campaign_oid = $1", [oid]);
    for (const line of lines) {
        const due = start + rng.int(0, Math.max(0, Math.floor((end - start) / DAY))) * DAY;
        const deliverable = uuidv4();
        const kind = rng.pick(["Post", "Reel", "Story"]);
        const quantity = rng.int(1, 3);
        await ok("manager", API.deliverable_create, { oid: deliverable, campaign_partner_oid: line.oid, kind, quantity, due_on: date_of(due) });
        schedule(due + rng.int(-1, 1) * DAY + 8 * HOUR, (moment) => {
            const status = moment > due + DAY ? "Late" : rng.chance(0.06) ? "Missed" : "Posted";
            return ok("manager", API.deliverable_update, { oid: deliverable, kind, quantity, due_on: date_of(due), status, posted_on: status === "Missed" ? null : date_of(moment) });
        });
        if (["Seeding", "InfluencerPost"].includes(plan.type)) schedule(start - 2 * DAY + 3 * HOUR, (moment) => seeding_gift(moment, line, chosen));
        schedule(end + rng.int(3, 10) * DAY, () => ok("manager", API.partner_payment, { oid: uuidv4(), campaign_partner_oid: line.oid, amount: line.fee, paid_on: date_of(clock_until + HOUR), payment_method: rng.pick(["bKash", "Nagad", "Bank"]) }));
    }
    schedule(start, () => ok("manager", API.campaign_start, { oid }));
    schedule(end + 14 * DAY + HOUR, () => ok("manager", API.campaign_complete, { oid }));
};

const seeding_gift = async (t, line, chosen) => {
    const partner = partners.find((p) => p.oid === line.partner_oid);
    const product = chosen.find((p) => units_of(p.oid, t) > 0);
    if (!product) return;
    const oid = uuidv4();
    const created = await ok("manager", API.gift_create, {
        oid,
        recipient_name: partner.name,
        recipient_phone: partner.phone,
        note: "Product for the partner to try before posting",
        campaign_partner_oid: line.oid,
        lines: [{ inventory_oid: sellable_of(product.oid, t)[0].oid, quantity: 1 }],
    });
    if (created && (await ok("manager", API.gift_give, { oid }))) await resync_stock([product.oid]);
};

const install_clock = async () => {
    await admin.query(`
        CREATE SCHEMA seedclock;
        CREATE TABLE seedclock.clock (real_start timestamptz NOT NULL, virtual_start timestamptz NOT NULL);
        INSERT INTO seedclock.clock VALUES (pg_catalog.now(), pg_catalog.now());
        CREATE TABLE seedclock.event (real_start timestamp PRIMARY KEY, shift interval NOT NULL);
        CREATE FUNCTION seedclock.now() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT virtual_start + (pg_catalog.now() - real_start) FROM seedclock.clock $$;
        CREATE FUNCTION seedclock.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT virtual_start + (pg_catalog.clock_timestamp() - real_start) FROM seedclock.clock $$;
    `);
};

const sign_in = async (person, password) => {
    const res = await fetch(base + C.AUTH + R.SIGN_IN, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: person.email, password, remember: false }) });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`${person.name} could not sign in: ${body.message}`);
    person.token = body.data.access_token;
};

const hire_staff = async () => {
    const [{ since }] = await read("SELECT LOCALTIMESTAMP AS since");
    const [owner] = await read("SELECT l.email FROM login l JOIN role r ON r.oid = l.role_oid WHERE r.name = 'Owner' AND l.status = 'Active' ORDER BY l.created_on LIMIT 1");
    if (!owner) throw new Error("No active Owner account: the owner hires the staff, so add the owner first.");
    for (const person of Object.values(STAFF)) {
        const [role] = await read("SELECT oid FROM role WHERE name = $1 AND status = 'Active'", [person.role]);
        if (!role) throw new Error(`The ${person.role} role is missing. Add it with its grants first.`);
        const password = crypto.randomBytes(24).toString("base64url");
        person.oid = uuidv4();
        await admin.query("INSERT INTO login (oid, email, password, name, designation, status, role_oid, created_by) VALUES ($1, $2, $3, $4, $5, 'Active', $6, $7)", [
            person.oid,
            person.email,
            await bcrypt.hash(password, 10),
            person.name,
            person.designation,
            role.oid,
            owner.email,
        ]);
        await sign_in(person, password);
    }
    await forget_sign_ins(since);
};

// Nobody knows the staff's passwords, so each catch-up gives them a new random one to sign in with.
const recall_staff = async () => {
    const [{ since }] = await read("SELECT LOCALTIMESTAMP AS since");
    for (const person of Object.values(STAFF)) {
        const [row] = await read("SELECT oid FROM login WHERE email = $1 AND status = 'Active'", [person.email]);
        if (!row) throw new Error(`${person.name} (${person.email}) is not an active account any more, so the business cannot carry on. Make the account active again first.`);
        const password = crypto.randomBytes(24).toString("base64url");
        person.oid = row.oid;
        await admin.query("UPDATE login SET password = $2, must_change_password = false WHERE oid = $1", [row.oid, await bcrypt.hash(password, 10)]);
        await sign_in(person, password);
    }
    await forget_sign_ins(since);
};

const forget_sign_ins = async (since) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    // The staff signed in through this process's own server, so these rows are theirs and nobody else's.
    await admin.query("DELETE FROM request_throttle WHERE bucket = 'sign-in-ip' AND identifier = '127.0.0.1' AND created_on >= $1", [since]);
    await admin.query("DELETE FROM api_request_log WHERE route LIKE '%/auth/sign-in' AND login_oid IS NULL AND occurred_on >= $1", [since]);
};

const NOUNS = {
    "CL-TSHIRT": ["Cotton T-Shirt", "Polo Shirt", "Graphic Tee", "Henley Tee"],
    "CL-PANJABI": ["Cotton Panjabi", "Silk Panjabi", "Kurta", "Embroidered Panjabi"],
    "CL-SAREE": ["Jamdani Saree", "Cotton Saree", "Three Piece", "Silk Saree"],
    "CL-DENIM": ["Slim Jeans", "Chino Trousers", "Straight Jeans", "Cargo Pants"],
    "CL-HOODIE": ["Fleece Hoodie", "Denim Jacket", "Puffer Jacket", "Zip Hoodie"],
    "SK-FACEWASH": ["Foaming Face Wash", "Gel Cleanser", "Rice Water Cleanser", "Micellar Water"],
    "SK-SERUM": ["Vitamin C Serum", "Niacinamide Serum", "Hyaluronic Serum", "Snail Essence"],
    "SK-MOIST": ["Day Cream", "Gel Moisturizer", "Night Cream", "Aloe Gel"],
    "SK-SUN": ["Sunscreen SPF 50", "Sun Stick", "Tinted Sunscreen", "Sun Gel"],
    "SK-MASK": ["Sheet Mask", "Clay Mask", "Sleeping Mask", "Peel Off Mask"],
    "BG-TOTE": ["Canvas Tote", "Leather Handbag", "Shopper Bag", "Jute Tote"],
    "BG-BACKPACK": ["Laptop Backpack", "School Backpack", "Travel Backpack", "Mini Backpack"],
    "BG-WALLET": ["Bifold Wallet", "Card Holder", "Long Wallet", "Coin Purse"],
    "BG-CROSS": ["Sling Bag", "Crossbody Bag", "Belt Bag", "Phone Pouch"],
    "FT-SNEAKER": ["Canvas Sneaker", "Running Shoe", "Slip On", "High Top"],
    "FT-SANDAL": ["Leather Sandal", "Slide", "Flip Flop", "Kolhapuri"],
    "FT-FORMAL": ["Oxford Shoe", "Loafer", "Derby Shoe", "Chelsea Boot"],
    "JW-WATCH": ["Analog Watch", "Chronograph Watch", "Smart Band", "Leather Strap Watch"],
    "JW-EARRING": ["Stud Earrings", "Jhumka", "Hoop Earrings", "Drop Earrings"],
    "JW-NECKLACE": ["Pendant Necklace", "Choker", "Chain Necklace", "Locket"],
    "JW-RING": ["Silver Ring", "Bangle Set", "Bracelet", "Adjustable Ring"],
    "BB-CLOTHES": ["Baby Romper", "Onesie Set", "Baby Frock", "Sleep Suit"],
    "BB-CARE": ["Baby Lotion", "Baby Shampoo", "Diaper Cream", "Baby Oil"],
    "BB-TOY": ["Soft Bear", "Rattle Set", "Stacking Rings", "Plush Bunny"],
    "HM-BED": ["Cotton Bedsheet", "Quilt Cover", "Pillow Cover Set", "Comforter"],
    "HM-CUSHION": ["Cushion Cover", "Throw Blanket", "Nakshi Cushion", "Floor Cushion"],
    "HM-DECOR": ["Wall Frame", "Ceramic Planter", "Table Lamp", "Wall Clock"],
    "KT-MUG": ["Ceramic Mug", "Tea Cup Set", "Coffee Mug", "Travel Mug"],
    "KT-BOTTLE": ["Steel Bottle", "Vacuum Flask", "Glass Bottle", "Kids Bottle"],
    "KT-ORG": ["Spice Rack", "Storage Basket", "Drawer Organizer", "Container Set"],
    "TC-CASE": ["Silicone Case", "Clear Case", "Wallet Case", "Rugged Case"],
    "TC-CABLE": ["USB-C Cable", "Lightning Cable", "Fast Charger", "Car Charger"],
    "TC-STAND": ["Laptop Stand", "Phone Stand", "Tablet Holder", "Cooling Pad"],
    "PF-ATTAR": ["Oud Attar", "Rose Attar", "Musk Attar", "Amber Attar"],
    "PF-MIST": ["Body Mist", "Deodorant Spray", "Hair Mist", "Roll On"],
    "PF-EDP": ["Eau De Parfum", "Gift Set", "Travel Spray", "Pour Homme"],
    "ST-NOTE": ["Daily Planner", "Spiral Notebook", "Sketchbook", "Journal"],
    "ST-PEN": ["Gel Pen Set", "Highlighter Set", "Marker Set", "Fountain Pen"],
    "PK-BOX": ["Shipping Box Small", "Shipping Box Medium", "Shipping Box Large"],
    "PK-POLY": ["Courier Poly Bag Small", "Courier Poly Bag Large", "Bubble Mailer"],
    "PK-TAPE": ["Packing Tape Brown", "Packing Tape Clear", "Fragile Tape"],
};
const STYLES = ["Classic", "Premium", "Everyday", "Signature", "Essential", "Urban", "Royal", "Soft", "Vintage", "Modern", "Deluxe", "Eco", "Festive", "Lite", "Heritage"];
const COLOURS = ["Black", "White", "Navy", "Maroon", "Olive", "Beige", "Grey", "Sky Blue", "Mustard", "Rose"];
const AISLE_FOR = { CLOTH: "A-01", SKIN: "A-03", PERF: "A-03", BAGS: "A-04", FOOT: "A-04", HOME: "A-05", KITCH: "A-05", PACK: "B-02", TECH: "B-03", JEWEL: "C-01", BABY: "C-02", STAT: "C-03" };

const set_up_catalogue = async () => {
    const warehouse_of = new Map();
    for (const w of bank.WAREHOUSES_DATA) {
        const made = await ok("manager", API.warehouse, { name: w.name, code: w.code, location: w.address, capacity_units: 5000, status: "Active" });
        warehouse_of.set(w.code, made.oid);
    }
    const aisle_of = new Map();
    for (const a of bank.AISLES_DATA) {
        const made = await ok("manager", API.aisle, { name: a.name.replace(" - ", ", "), code: a.code, warehouse_oid: warehouse_of.get(a.whCode), storage_type: a.type, capacity_units: a.capacity, status: "Active" });
        aisle_of.set(a.code, { oid: made.oid, warehouse_oid: warehouse_of.get(a.whCode) });
    }
    const category_of = new Map();
    for (const c of bank.CATEGORIES_DATA) {
        const made = await ok("manager", API.category, { name: c.name, category_code: c.code, description: c.desc, status: "Active" });
        category_of.set(c.code, made.oid);
    }
    const brands = [];
    for (const b of bank.BRANDS_DATA) brands.push((await ok("manager", API.brand, { name: b.name, origin_country: b.country, status: "Active" })).oid);
    for (const s of bank.SUPPLIERS_DATA) {
        const made = await ok("manager", API.supplier, { name: s.name, contact_person: s.person, phone_number: s.phone, email: s.email, address: `${s.city}`, status: "Active" });
        suppliers.push({ oid: made.oid, name: s.name });
    }
    const names = new Set();
    let sku = 0;
    for (const sc of bank.SUB_CATEGORIES_DATA) {
        const sub = await ok("manager", API.sub_category, { name: sc.name, category_code: sc.code, category_oid: category_of.get(sc.cat), status: "Active" });
        const packaging = sc.cat === "PACK";
        const count = packaging ? 7 : 10;
        for (let i = 0; i < count; i++) {
            let name;
            do {
                const noun = rng.pick(NOUNS[sc.code]);
                name = packaging ? `${noun} ${rng.pick(["Pack of 50", "Pack of 100", "Roll", "Bundle"])}` : `${rng.pick(STYLES)} ${noun}, ${rng.pick(COLOURS)}`;
            } while (names.has(name));
            names.add(name);
            sku += 1;
            const has_expiry = ["SKIN", "BABY"].includes(sc.cat) && sc.code !== "BB-CLOTHES" && sc.code !== "BB-TOY" && rng.chance(0.55);
            const restock_threshold = packaging ? 50 : rng.chance(0.7) ? rng.pick([3, 5, 8, 10, 15]) : 0;
            const made = await ok("manager", API.product, {
                name,
                sku: `${sc.cat}-${String(sku).padStart(4, "0")}`,
                sub_category_oid: sub.oid,
                brand_oid: packaging ? null : rng.pick(brands),
                unit_type: packaging ? "pack" : ["FOOT"].includes(sc.cat) || sc.code === "JW-EARRING" ? "pair" : "pcs",
                restock_threshold,
                has_expiry,
                status: "Active",
            });
            const aisle = aisle_of.get(AISLE_FOR[sc.cat]);
            const cost = packaging ? rng.int(3, 30) * 10 : rng.int(15, 250) * 10;
            const product = {
                oid: made.oid,
                name,
                packaging,
                has_expiry,
                restock_threshold,
                cost,
                price: Math.round((cost * rng.float(1.4, 1.9)) / 10) * 10,
                supplier_index: rng.pick(SUPPLIERS_BY_CATEGORY[sc.cat]),
                warehouse_oid: aisle.warehouse_oid,
                aisle_oid: aisle.oid,
                weight: 0,
                velocity: 0,
                discontinued_from: null,
            };
            products.push(product);
            product_by_oid.set(product.oid, product);
            batches_of.set(product.oid, []);
        }
    }
    const selling = rng.shuffle(products.filter((p) => !p.packaging));
    const daily_units = 75;
    selling.forEach((p, rank) => (p.weight = rank > selling.length - 12 ? 0.02 : 1 / Math.pow(rank + 1, 0.75)));
    const sum = selling.reduce((s, p) => s + p.weight, 0);
    for (const p of selling) p.velocity = (daily_units * p.weight) / sum;
    for (const p of rng.shuffle(selling).slice(0, 14)) p.discontinued_from = rng.int(Math.floor(DAYS * 0.65), Math.floor(DAYS * 0.9));
};

const ms = (column) => `(extract(epoch FROM ${column}) * 1000)::float8`;
const who_of = (email, fallback) => Object.keys(STAFF).find((key) => STAFF[key].email === email) ?? fallback;
const soon = (hours_from, hours_to) => START + rng.int(hours_from * 60, hours_to * 60) * MINUTE;

const resume_business = async () => {
    for (const s of bank.SUPPLIERS_DATA) {
        const [row] = await read("SELECT oid FROM supplier WHERE name = $1", [s.name]);
        suppliers.push(row ? { oid: row.oid, name: s.name } : null);
    }
    const supplier_index = new Map(suppliers.map((s, i) => [s?.oid, i]));

    const rows = await read(
        `SELECT p.oid, p.name, p.restock_threshold::int AS restock_threshold, p.has_expiry, c.category_code = 'PACK' AS packaging, po.cost, po.supplier_oid, po.warehouse_oid, po.aisle_oid,
                (SELECT i.selling_price::int FROM inventory i WHERE i.product_oid = p.oid AND i.selling_price IS NOT NULL ORDER BY i.created_on DESC LIMIT 1) AS price,
                (SELECT COALESCE(SUM(oi.quantity - oi.returned_qty), 0)::int FROM order_items oi JOIN orders o ON o.oid = oi.order_oid WHERE oi.product_oid = p.oid AND o.sold_on >= to_timestamp($1::float8 / 1000) AT TIME ZONE 'UTC') AS sold
           FROM product p
           JOIN sub_categories s ON s.oid = p.sub_category_oid
           JOIN categories c ON c.oid = s.category_oid
           JOIN LATERAL (SELECT d.ordered_unit_price::int AS cost, pu.supplier_oid, d.warehouse_oid, d.aisle_oid FROM purchase_details d JOIN purchase pu ON pu.oid = d.purchase_oid
                          WHERE d.product_oid = p.oid ORDER BY pu.created_on DESC LIMIT 1) po ON true
          WHERE p.status = 'Active' AND NOT p.is_deleted`,
        [START - 60 * DAY]
    );
    for (const r of rows) {
        if (!supplier_index.has(r.supplier_oid)) continue;
        const velocity = r.sold / 60;
        const product = { ...r, price: r.price ?? Math.round((r.cost * 1.6) / 10) * 10, supplier_index: supplier_index.get(r.supplier_oid), velocity, weight: Math.max(velocity, 0.02), discontinued_from: null };
        products.push(product);
        product_by_oid.set(product.oid, product);
        batches_of.set(product.oid, []);
    }
    await resync_stock();
    // A product that sold nothing for two months and has nothing on the shelf was let go: never reorder it.
    for (const p of products) if (!p.packaging && !p.sold && units_of(p.oid, START) === 0) p.discontinued_from = 0;

    const by_phone = new Map();
    const people = await read(
        `SELECT c.phone, c.name, c.gender, c.age_band, a.oid AS address_oid, a.address_line, a.district_oid, a.thana_oid
           FROM customers c
           LEFT JOIN LATERAL (SELECT * FROM customer_address a WHERE a.customer_oid = c.oid AND a.status = 'Active' ORDER BY a.is_default DESC, a.created_on LIMIT 1) a ON true
          WHERE c.phone IS NOT NULL`
    );
    for (const p of people) {
        const district = p.address_oid && districts.find((d) => d.oid === p.district_oid);
        const home = district ? { district, thana: { oid: p.thana_oid }, address_line: p.address_line, address_oid: p.address_oid } : new_home();
        const customer = { phone: p.phone, name: p.name, gender: p.gender, age_band: p.age_band, ...home, orders: 0 };
        customers.push(customer);
        by_phone.set(p.phone, customer);
    }

    // Online orders still moving, as the records the day's own events would have kept.
    const lines_of = new Map();
    for (const l of await read("SELECT oi.order_oid, oi.inventory_oid, oi.product_oid, oi.quantity::int AS quantity FROM order_items oi JOIN orders o ON o.oid = oi.order_oid WHERE o.channel = 'ONLINE' AND (o.status IN ('Pending', 'Confirmed') OR o.refund_status = 'ToRefund')")) {
        if (!lines_of.has(l.order_oid)) lines_of.set(l.order_oid, []);
        lines_of.get(l.order_oid).push(l);
    }
    const open = await read(
        `SELECT o.oid, o.status, o.created_by, o.payment_type, o.customer_phone, o.refund_status, oo.delivery_status,
                (SELECT bo.batch_oid FROM delivery_batch_order bo WHERE bo.order_oid = o.oid AND bo.active LIMIT 1) AS batch_oid,
                (SELECT pr.oid FROM product_return pr WHERE pr.order_oid = o.oid AND pr.status = 'Pending' AND pr.return_reason = 'not_delivered' LIMIT 1) AS failed_return_oid
           FROM orders o JOIN online_order oo ON oo.order_oid = o.oid
          WHERE o.status IN ('Pending', 'Confirmed') OR o.refund_status = 'ToRefund'`
    );
    const road = new Map();
    let moving = 0;
    for (const o of open) {
        const customer = by_phone.get(o.customer_phone);
        if (!customer) continue;
        const record = { oid: o.oid, who: who_of(o.created_by, "moderator_a"), customer, lines: lines_of.get(o.oid) ?? [], payment_type: o.payment_type, prepaid: o.payment_type !== "COD" };
        moving += 1;
        if (o.status === "Pending") schedule(soon(0.5, 5), (moment) => confirm_order(moment, record));
        else if (o.status === "Confirmed" && o.failed_return_oid) schedule(soon(2, 48), () => back_in_shop(o.failed_return_oid, record));
        else if (o.status === "Confirmed" && o.delivery_status === "WithCourier" && o.batch_oid) {
            if (!road.has(o.batch_oid)) road.set(o.batch_oid, []);
            road.get(o.batch_oid).push(record);
        } else if (o.status === "Confirmed" && ["Preparing", "Packed"].includes(o.delivery_status) && !o.batch_oid) get_ready(record);
        else if (o.refund_status === "ToRefund") schedule(soon(4, 72), () => refund(record));
        else moving -= 1;
    }
    for (const [batch_oid, records] of road) on_the_road(START, batch_oid, records);

    // Returns raised and not yet confirmed: the counter's by the manager, online ones by dispatch.
    const returns = await read(
        `SELECT pr.oid, pr.order_oid, o.channel, o.payment_type, (SELECT array_agg(DISTINCT rd.product_oid) FROM return_details rd WHERE rd.return_oid = pr.oid) AS product_oids
           FROM product_return pr JOIN orders o ON o.oid = pr.order_oid
          WHERE pr.status = 'Pending' AND pr.return_reason <> 'not_delivered'`
    );
    for (const r of returns) {
        schedule(soon(2, 96), async () => {
            const body = r.channel === "POS" ? { oid: r.oid, refund_method: rng.pickWeighted(["cash", "bkash"], [80, 20]) } : { oid: r.oid };
            if (!(await ok(r.channel === "POS" ? "manager" : "dispatch", API.return_confirm, body))) return;
            await resync_stock(r.product_oids);
            if (r.channel === "ONLINE") schedule(clock_until + rng.int(4, 72) * HOUR, () => refund({ oid: r.order_oid }));
        });
    }

    // Purchase orders: the goods still to arrive, and the suppliers still to be paid.
    const waiting = await read(
        `SELECT pu.oid, pu.payment_status, ${ms("pu.expected_delivery_date::timestamp")} AS expected, d.product_oid, d.ordered_quantity::int AS quantity
           FROM purchase pu JOIN purchase_details d ON d.purchase_oid = pu.oid WHERE pu.status = 'Submitted'`
    );
    const pos = new Map();
    for (const w of waiting) {
        const product = product_by_oid.get(w.product_oid);
        if (!product) continue;
        if (!pos.has(w.oid)) pos.set(w.oid, { oid: w.oid, lines: [], payment_status: w.payment_status, packaging: product.packaging, expected: w.expected });
        pos.get(w.oid).lines.push({ product, quantity: w.quantity });
        open_po_units.set(product.oid, (open_po_units.get(product.oid) || 0) + w.quantity);
    }
    for (const po of pos.values()) schedule(Math.max(soon(1, 6), po.expected - DHAKA + rng.int(11 * 60, 16 * 60) * MINUTE), (moment) => verify_po(moment, po));
    const unpaid = await read(`SELECT oid, total_amount::int AS total, ${ms("verified_on")} AS verified FROM purchase WHERE status = 'Verified' AND payment_status <> 'paid' AND verified_on IS NOT NULL`);
    for (const p of unpaid) {
        const due = p.verified + rng.int(7, 45) * DAY;
        if (p.verified + 45 * DAY < START || rng.chance(0.1)) continue;
        schedule(Math.max(due, soon(1, 24)), () => ok("manager", API.po_payment, { oid: p.oid, payment_status: "paid", paid_amount: p.total }));
    }

    // Pre-orders still waiting for their stock.
    const bookings = await read(
        `SELECT p.oid, p.status, p.created_by, p.customer_phone, p.advance_paid::int AS advance, json_agg(json_build_object('product_oid', i.product_oid, 'quantity', i.quantity::int)) AS lines
           FROM pre_orders p JOIN pre_order_items i ON i.pre_order_oid = p.oid WHERE p.status IN ('Pending', 'Confirmed') GROUP BY p.oid`
    );
    for (const b of bookings) {
        const customer = by_phone.get(b.customer_phone);
        if (!customer) continue;
        const booking = { oid: b.oid, who: who_of(b.created_by, "moderator_a"), customer, advance: b.advance || 0, lines: b.lines, tries: 0 };
        if (b.status === "Pending") schedule(soon(1, 12), () => ok(booking.who, API.pre_confirm, { oid: b.oid }));
        schedule(soon(24, 96), (moment) => convert_pre_order(moment, booking));
    }

    // Campaigns that should have gone live or finished meanwhile.
    const campaigns = await read(`SELECT oid, status, ${ms("posting_start::timestamp")} AS starts, ${ms("measure_end::timestamp")} AS ends FROM campaign WHERE status IN ('Planned', 'Live')`);
    for (const c of campaigns) {
        if (c.status === "Planned") schedule(Math.max(soon(0.5, 3), c.starts - DHAKA + 10 * HOUR), () => ok("manager", API.campaign_start, { oid: c.oid }));
        schedule(Math.max(soon(4, 8), c.ends - DHAKA + 23 * HOUR), () => ok("manager", API.campaign_complete, { oid: c.oid }));
    }

    console.log(`Picked up ${products.length} products, ${customers.length} customers, ${moving} online orders on the move, ${returns.length} returns, ${pos.size} purchase orders to receive, ${bookings.length} pre-orders and ${campaigns.length} campaigns.`);
};

const plan_day = (day) => {
    const lift = demand(day);
    const growth = 0.6 + 0.8 * Math.min(1, (AGE + day) / 365);
    if (day === 0 || [0, 3].includes(new Date(at(day, 12) + DHAKA).getUTCDay())) schedule(at(day, 9, 30), (t) => restock(t));
    if ((AGE + day) % 30 === 3) schedule(at(day, 10), (t) => restock_packaging(t));
    if (AGE + day < 4) return;
    const pos = Math.round(21 * lift * rng.float(0.8, 1.2));
    for (let i = 0; i < pos; i++) schedule(at(day, 10) + rng.int(0, 11.5 * 60) * MINUTE, (t) => pos_sale(t));
    const online = Math.round(14 * lift * growth * rng.float(0.8, 1.2));
    for (let i = 0; i < online; i++) schedule(at(day, 9) + rng.int(0, 14.5 * 60) * MINUTE, (t) => online_order(t));
    schedule(at(day, 17, rng.int(0, 30)), (t) => send_batches(t));
    if (rng.chance(120 / 365)) schedule(at(day, rng.int(11, 20)), (t) => pre_order(t));
    if (rng.chance(40 / 365)) schedule(at(day, rng.int(10, 13)), (t) => adjustment(t));
    if (rng.chance(30 / 365)) schedule(at(day, rng.int(10, 13)), (t) => disposal(t));
    if (rng.chance(40 / 365)) schedule(at(day, rng.int(11, 18)), (t) => goodwill_gift(t));
};

const shift_the_rest = async (since) => {
    const skip = ["auth_session", "auth_refresh_token", "auth_event", "otp_log", "request_throttle", "api_request_log", "config_version"];
    const columns = await read(
        `SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
          WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.data_type = 'timestamp without time zone' AND NOT (c.table_name = ANY($1))`,
        [skip]
    );
    for (const { table_name, column_name } of columns) {
        const moved = await admin.query(
            `UPDATE "${table_name}" x SET "${column_name}" = x."${column_name}" + COALESCE(
                    (SELECT e.shift FROM seedclock.event e WHERE e.real_start <= x."${column_name}" ORDER BY e.real_start DESC LIMIT 1),
                    (SELECT e.shift FROM seedclock.event e ORDER BY e.real_start LIMIT 1))
              WHERE x."${column_name}" >= $1`,
            [since]
        );
        if (moved.rowCount) console.log(`  ${table_name}.${column_name}: ${moved.rowCount}`);
    }
};

const main = async () => {
    await admin.connect();
    const [{ timezone }] = await read("SELECT current_setting('TimeZone') AS timezone");
    if (!["UTC", "Etc/UTC", "GMT"].includes(timezone)) throw new Error(`The database runs in ${timezone}. Stored times are UTC: set it to UTC first.`);
    const [{ n }] = await read("SELECT count(*)::int AS n FROM orders");
    if (!CATCH_UP && n) throw new Error("This database already holds orders. The seed builds the business from an empty database: rebuild it from generated_schema.sql first, or pass --catch-up to carry the business on to today.");
    if (CATCH_UP) {
        if (!n) throw new Error("There is no business to carry on: run the seed without --catch-up first.");
        // Only the staff's own work marks where the business stopped: what a person did in the app since is real time.
        const [{ last, first }] = await read(
            `SELECT ${ms("(SELECT max(performed_on) FROM activity_log WHERE performed_by = ANY($1))")} AS last, ${ms("(SELECT min(created_on) FROM orders)")} AS first`,
            [Object.values(STAFF).map((p) => p.email)]
        );
        if (!last) throw new Error("None of the seed's staff has done anything here, so there is no business of theirs to carry on.");
        if (END - last < HOUR) {
            console.log(`Nothing to fill: the business is up to date (last activity ${new Date(last + DHAKA).toISOString().slice(0, 16).replace("T", " ")} Dhaka time).`);
            await admin.end();
            return;
        }
        START = last;
        DAY0 = midnight_of(START);
        DAYS = day_of(END);
        AGE = Math.round((DAY0 - midnight_of(first)) / DAY);
    }
    for (const r of await read("SELECT phone_normalized FROM customers WHERE phone_normalized IS NOT NULL")) known_phones.add(r.phone_normalized);

    districts = await read("SELECT oid, name_en FROM district WHERE status = 'Active'");
    const thanas = await read("SELECT oid, name_en, district_oid FROM thana WHERE status = 'Active'");
    for (const t of thanas) {
        if (!thanas_of.has(t.district_oid)) thanas_of.set(t.district_oid, []);
        thanas_of.get(t.district_oid).push(t);
    }
    districts = districts.filter((d) => thanas_of.has(d.oid));
    dhaka_oid = districts.find((d) => d.name_en === "Dhaka")?.oid;
    const SOURCE_WEIGHT = { Facebook: 45, Instagram: 20, WhatsApp: 15, Website: 8, Phone: 7, Other: 5 };
    for (const s of await read("SELECT oid, platform FROM order_source WHERE status = 'Active'")) sources.push({ oid: s.oid, weight: SOURCE_WEIGHT[s.platform] ?? 5 });
    if (!dhaka_oid || !sources.length) throw new Error("The district list or the order sources are missing. Restore the reference data first.");

    const app = require("../server");
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;

    // Only rows this run writes move onto the year: the reference data loaded minutes earlier stays put.
    const [{ since }] = await read("SELECT LOCALTIMESTAMP AS since");
    try {
        await install_clock();
        if (CATCH_UP) {
            await recall_staff();
            console.log(`Catching up from ${new Date(START + DHAKA).toISOString().slice(0, 16).replace("T", " ")} to ${new Date(END + DHAKA).toISOString().slice(0, 16).replace("T", " ")} (Dhaka time), into ${process.env.DB_NAME}`);
            await resume_business();
            schedule(soon(0.25, 1), (t) => restock(t));
        } else {
            await hire_staff();
            console.log(`Seeding ${DAYS} days, ${date_of(DAY0)} to ${date_of(END)}, into ${process.env.DB_NAME}`);
            await play({ t: at(0, 8, 30), fn: set_up_catalogue });
            for (const p of bank.PARTNERS_DATA) {
                schedule(at(rng.int(1, 12), rng.int(10, 17)), async () => {
                    const phone = new_phone();
                    const made = await ok("manager", API.partner, { name: p.name, partner_type: p.type, platforms: p.platforms, handle: p.handle, phone_number: phone, payment_method: p.method, status: "Active" });
                    if (made) partners.push({ oid: made.oid, name: p.name, phone });
                });
            }
            schedule(at(0, 11, 30), (t) => restock_packaging(t));
            for (const plan of bank.CAMPAIGNS_DATA) {
                const start_day = DAYS - plan.startDaysAgo;
                if (start_day - 7 >= 14) schedule(at(start_day - 7, 15), (t) => campaign(t, plan));
            }
        }
        for (let day = 0; day <= DAYS; day++) schedule(Math.max(at(day, 8), START + 1000), async () => {
            plan_day(day);
            await resync_stock();
        });

        let played = 0;
        let last_day = -1;
        while (queue.length) {
            const event = pop();
            await play(event);
            played += 1;
            const day = day_of(event.t);
            if (day !== last_day && (CATCH_UP || day % 15 === 0)) {
                console.log(`  ${date_of(event.t)}: ${played} events, ${[...failures.values()].reduce((a, b) => a + b, 0)} refused`);
                last_day = day;
            }
        }

        const staff = Object.values(STAFF).map((p) => p.oid);
        await admin.query("DELETE FROM api_request_log WHERE login_oid = ANY($1)", [staff]);
        console.log(`Done: ${played} events played.`);
        if (failures.size) console.table([...failures].map(([call, count]) => ({ call, count })));
    } finally {
        // Also after a failure: rows already written must land on the business's clock, or the next
        // catch-up would read them as the present and think nothing is missing.
        if ((await read("SELECT to_regclass('seedclock.event') IS NOT NULL AS installed"))[0].installed) {
            console.log("Moving the real-time stamps onto the business's clock:");
            await shift_the_rest(since);
        }
        await admin.query("DROP SCHEMA IF EXISTS seedclock CASCADE");
        server.close();
        await admin.end();
        await require("../src/db/db.config").end();
    }
};

main().catch((e) => {
    console.error(`Seeding stopped: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
});
