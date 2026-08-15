const { TABLE } = require("../../../../utils/constant");
const pool = require("../../../../utils/db.config");
const { get_data } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordStatusHistory, nextInvoiceNo } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

// Create a PRE-ORDER: order_type Preorder, status Pending, NO stock hold (stock
// hasn't arrived). A pre-order is never mixed with in-stock items -- the whole
// order is a pre-order. It's converted to a normal in-stock order later.
const create_preorder = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    const products = Array.isArray(payload.products) ? payload.products : [];
    const customer = payload.customer || {};

    if (!products.length) return res.status(400).json({ code: 400, message: "At least one product line is required" });
    if (!customer.address || !String(customer.address).trim()) {
        return res.status(400).json({ code: 400, message: "A delivery address is required to save a pre-order" });
    }

    // Validate the products exist (a pre-order references products, not batches).
    const product_oids = [...new Set(products.map((p) => p.product_oid))];
    const found = await get_data({ text: `SELECT oid FROM ${TABLE.PRODUCT} WHERE oid = ANY($1) AND is_deleted = FALSE`, values: [product_oids] });
    if (found.length !== product_oids.length) return res.status(400).json({ code: 400, message: "One or more products no longer exist" });

    const subtotal = products.reduce((s, p) => s + Number(p.total || 0), 0);
    const discount_total = Number(payload.discount_total || 0);
    const delivery_charge = Number(payload.delivery_charge || 0);
    const total_amount = subtotal - discount_total + delivery_charge;

    const order_oid = uuidv4();
    const customer_oid = uuidv4();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query({
            text: `INSERT INTO ${TABLE.CUSTOMERS} (oid, name, phone, address, social_handle, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            values: [customer_oid, customer.name || null, customer.phone || null, customer.address, customer.social_handle || null, customer.note || null, user_id],
        });
        const invoice_no = payload.invoice_no || (await nextInvoiceNo((q) => client.query(q).then((r) => r.rows)));
        await client.query({
            text: `INSERT INTO ${TABLE.ORDERS}
                     (oid, invoice_no, channel, order_type, customer_oid, customer_name, customer_phone, customer_address, customer_email,
                      subtotal, discount_total, delivery_charge, total_amount, payment_type, payment_status, status, notes, created_by)
                   VALUES ($1,$2,'ONLINE','Preorder',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Pending',$14,$15)`,
            values: [order_oid, invoice_no, customer_oid, customer.name || null, customer.phone || null, customer.address, customer.email || null,
                subtotal, discount_total, delivery_charge, total_amount, payload.payment_type || "COD", payload.payment_status || "unpaid", payload.note || null, user_id],
        });
        for (const p of products) {
            await client.query({
                text: `INSERT INTO ${TABLE.ORDER_ITEMS} (oid, order_oid, inventory_oid, product_oid, product_name, quantity, unit_price, discount, total, returned_qty)
                       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,0)`,
                values: [uuidv4(), order_oid, p.product_oid, p.product_name, p.quantity, p.unit_price, p.discount ?? 0, p.total],
            });
        }
        await recordStatusHistory(client, { order_oid, from_status: null, to_status: "Pending", reason: "Pre-order created (awaiting stock)", user_id });
        await client.query("COMMIT");

        saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Pre-Order Created", description: `Pre-order ${invoice_no} created (no stock held), ${products.length} item(s)`, performed_by: user_id });
        log.info(`Pre-order ${invoice_no} created by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Pre-order created", data: { oid: order_oid, invoice_no } });
    } catch (e) {
        try { await client.query("ROLLBACK"); } catch (r) { log.error(`Rollback failed on create preorder: ${r?.message}`); }
        log.error(`An exception occurred while creating pre-order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    } finally {
        client.release();
    }
};

module.exports = create_preorder;
