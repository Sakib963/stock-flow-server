const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail, get_data } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { holdStock } = require("../../../../utils/stock-movement");
const { recordStatusHistory, nextInvoiceNo } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

// Create an in-stock ONLINE order. Result: status Pending, stock HELD per batch
// (reversible), NO physical deduction yet. Customer + delivery address required.
// Smart Fill only prefills the form; products are chosen manually by the admin.
const create_online_order = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    const products = Array.isArray(payload.products) ? payload.products : [];
    const customer = payload.customer || {};

    if (!products.length) return res.status(400).json({ code: 400, message: "At least one product line is required" });
    if (!customer.address || !String(customer.address).trim()) {
        return res.status(400).json({ code: 400, message: "A delivery address is required to save an online order" });
    }

    // Server-side batch validation.
    const inventory_oids = [...new Set(products.map((p) => p.inventory_oid))];
    const inventoryRows = await get_data({
        text: `SELECT oid, product_oid, intended_use, status FROM ${TABLE.INVENTORY} WHERE oid = ANY($1)`,
        values: [inventory_oids],
    });
    const byOid = new Map(inventoryRows.map((r) => [r.oid, r]));
    for (const p of products) {
        const b = byOid.get(p.inventory_oid);
        if (!b) return res.status(400).json({ code: 400, message: "One or more selected batches no longer exist" });
        if (b.product_oid !== p.product_oid) return res.status(400).json({ code: 400, message: "Product/batch mismatch in payload" });
        if (b.intended_use !== "for_sale" || b.status !== "ready_for_sale") {
            return res.status(400).json({ code: 400, message: "One or more batches are not available for sale" });
        }
    }

    const subtotal = products.reduce((s, p) => s + Number(p.total || 0), 0);
    const discount_total = Number(payload.discount_total || 0);
    const delivery_charge = Number(payload.delivery_charge || 0);
    const total_amount = subtotal - discount_total + delivery_charge;
    const amount_paid = Number(payload.amount_paid || 0);

    const order_oid = uuidv4();
    const customer_oid = uuidv4();

    try {
        const invoice_no = await execute_transaction(async (tx) => {
            await tx.execute_value({
                text: `INSERT INTO ${TABLE.CUSTOMERS} (oid, name, phone, address, city, zone, area, postcode, social_handle, note, created_by)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                values: [customer_oid, customer.name || null, customer.phone || null, customer.address, customer.city || null, customer.zone || null, customer.area || null, customer.postcode || null, customer.social_handle || null, customer.note || null, user_id],
            });

            const invoice_no = payload.invoice_no || (await nextInvoiceNo(tx.get_data));

            await tx.execute_value({
                text: `INSERT INTO ${TABLE.ORDERS}
                         (oid, invoice_no, channel, order_type, customer_oid, customer_name, customer_phone, customer_address, customer_email,
                          delivery_city, delivery_zone, delivery_area, delivery_postcode,
                          subtotal, discount_total, delivery_charge, total_amount, amount_paid,
                          payment_type, payment_status, status, notes, created_by)
                       VALUES ($1,$2,'ONLINE','Standard',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'Pending',$19,$20)`,
                values: [
                    order_oid, invoice_no, customer_oid,
                    customer.name || null, customer.phone || null, customer.address, customer.email || null,
                    customer.city || null, customer.zone || null, customer.area || null, customer.postcode || null,
                    subtotal, discount_total, delivery_charge, total_amount, amount_paid,
                    payload.payment_type || "COD", payload.payment_status || "unpaid",
                    payload.note || null, user_id,
                ],
            });

            for (const p of products) {
                const order_item_oid = uuidv4();
                await tx.execute_value({
                    text: `INSERT INTO ${TABLE.ORDER_ITEMS}
                             (oid, order_oid, inventory_oid, product_oid, product_name, available_stock, quantity, unit_price, discount, total, returned_qty)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)`,
                    values: [order_item_oid, order_oid, p.inventory_oid, p.product_oid, p.product_name, p.quantity_available ?? null, p.quantity, p.unit_price, p.discount ?? 0, p.total],
                });

                const hold = await holdStock(tx, { order_oid, order_item_oid, product_oid: p.product_oid, inventory_oid: p.inventory_oid, quantity: p.quantity, user_id });
                if (!hold.ok) fail(409, `Not enough sellable stock to hold "${p.product_name}" (need ${p.quantity}, ${hold.sellable} sellable). Book it as a pre-order instead.`);
            }

            await recordStatusHistory(tx, { order_oid, from_status: null, to_status: "Pending", reason: "Online order created", user_id });
            return invoice_no;
        });

        saveLogActivity({
            reference_type: "order",
            reference_oid: order_oid,
            title: "Online Order Created",
            description: `Online order ${invoice_no} created (Pending), ${products.length} item(s), stock held`,
            performed_by: user_id,
        });

        log.info(`Online order ${invoice_no} created (Pending) by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Online order created and stock held", data: { oid: order_oid, invoice_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while creating online order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = create_online_order;
