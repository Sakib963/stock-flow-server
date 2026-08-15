const { TABLE } = require("../../../../utils/constant");
const pool = require("../../../../utils/db.config");
const { get_data } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordStatusHistory, nextInvoiceNo } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

// Save an ONLINE order as a DRAFT: parks it as a Draft order (channel ONLINE) with
// NO stock hold and NO deduction. `oid` updates an existing Draft in place; omitting
// it creates a new one. Stock is only ever held when the draft is finalized into a
// real online order (create-online-order). The customer row is created at finalize
// time, not for drafts -- a draft keeps its details on the order columns only.
const save_online_draft = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    const customer = payload.customer || {};
    const products = Array.isArray(payload.products) ? payload.products : [];

    if (!products.length) {
        return res.status(400).json({ code: 400, message: "At least one product line is required" });
    }

    // Light identity validation only (no stock committed for a draft).
    const inventory_oids = [...new Set(products.map((p) => p.inventory_oid).filter(Boolean))];
    if (inventory_oids.length) {
        const inventoryRows = await get_data({ text: `SELECT oid, product_oid FROM ${TABLE.INVENTORY} WHERE oid = ANY($1)`, values: [inventory_oids] });
        const byOid = new Map(inventoryRows.map((r) => [r.oid, r]));
        for (const p of products) {
            if (!p.inventory_oid) continue;
            const b = byOid.get(p.inventory_oid);
            if (!b) return res.status(400).json({ code: 400, message: "One or more selected batches no longer exist" });
            if (b.product_oid !== p.product_oid) return res.status(400).json({ code: 400, message: "Product/batch mismatch in payload" });
        }
    }

    const subtotal = products.reduce((s, p) => s + Number(p.total || 0), 0);
    const discount_total = Number(payload.discount_total || 0);
    const delivery_charge = Number(payload.delivery_charge || 0);
    const total_amount = subtotal - discount_total + delivery_charge;
    const amount_paid = Number(payload.amount_paid || 0);
    const isUpdate = Boolean(payload.oid);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        let order_oid = payload.oid;
        let invoice_no = payload.invoice_no;

        if (isUpdate) {
            const existing = await client.query({ text: `SELECT oid, status FROM ${TABLE.ORDERS} WHERE oid = $1 FOR UPDATE`, values: [order_oid] }).then((r) => r.rows);
            if (!existing.length) { await client.query("ROLLBACK"); return res.status(404).json({ code: 404, message: "Draft order not found" }); }
            if (existing[0].status !== "Draft") { await client.query("ROLLBACK"); return res.status(409).json({ code: 409, message: "Only draft orders can be edited" }); }

            await client.query({
                text: `UPDATE ${TABLE.ORDERS} SET
                          customer_name=$2, customer_phone=$3, customer_address=$4, customer_email=$5,
                          delivery_city=$6, delivery_zone=$7, delivery_area=$8, delivery_postcode=$9,
                          subtotal=$10, discount_total=$11, delivery_charge=$12, total_amount=$13, amount_paid=$14,
                          payment_type=$15, payment_status=$16, notes=$17, edited_by=$18, edited_on=NOW()
                        WHERE oid=$1`,
                values: [
                    order_oid, customer.name || null, customer.phone || null, customer.address || null, customer.email || null,
                    customer.city || null, customer.zone || null, customer.area || null, customer.postcode || null,
                    subtotal, discount_total, delivery_charge, total_amount, amount_paid,
                    payload.payment_type || "COD", payload.payment_status || "unpaid", payload.note || null, user_id,
                ],
            });
            await client.query({ text: `DELETE FROM ${TABLE.ORDER_ITEMS} WHERE order_oid=$1`, values: [order_oid] });
        } else {
            order_oid = uuidv4();
            invoice_no = payload.invoice_no || (await nextInvoiceNo((q) => client.query(q).then((r) => r.rows)));

            await client.query({
                text: `INSERT INTO ${TABLE.ORDERS}
                         (oid, invoice_no, channel, order_type, customer_name, customer_phone, customer_address, customer_email,
                          delivery_city, delivery_zone, delivery_area, delivery_postcode,
                          subtotal, discount_total, delivery_charge, total_amount, amount_paid,
                          payment_type, payment_status, status, notes, created_by)
                       VALUES ($1,$2,'ONLINE','Standard',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'Draft',$18,$19)`,
                values: [
                    order_oid, invoice_no, customer.name || null, customer.phone || null, customer.address || null, customer.email || null,
                    customer.city || null, customer.zone || null, customer.area || null, customer.postcode || null,
                    subtotal, discount_total, delivery_charge, total_amount, amount_paid,
                    payload.payment_type || "COD", payload.payment_status || "unpaid", payload.note || null, user_id,
                ],
            });
            await recordStatusHistory(client, { order_oid, from_status: null, to_status: "Draft", reason: "Online draft saved", user_id });
        }

        for (const p of products) {
            await client.query({
                text: `INSERT INTO ${TABLE.ORDER_ITEMS} (oid, order_oid, inventory_oid, product_oid, product_name, available_stock, quantity, unit_price, discount, total, returned_qty)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)`,
                values: [uuidv4(), order_oid, p.inventory_oid || null, p.product_oid, p.product_name, p.quantity_available ?? null, p.quantity, p.unit_price, p.discount ?? 0, p.total],
            });
        }

        await client.query("COMMIT");

        saveLogActivity({
            reference_type: "order",
            reference_oid: order_oid,
            title: isUpdate ? "Online Draft Updated" : "Online Draft Saved",
            description: `Online draft ${invoice_no} saved with ${products.length} line item(s)`,
            performed_by: user_id,
        });

        log.info(`Online draft ${invoice_no} saved by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Draft saved successfully!", data: { oid: order_oid, invoice_no } });
    } catch (e) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            log.error(`Rollback failed during online draft save: ${rollbackError?.message}`);
        }
        log.error(`An exception occurred while saving online draft: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    } finally {
        client.release();
    }
};

module.exports = save_online_draft;
