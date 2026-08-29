const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail, get_data } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordStatusHistory, nextInvoiceNo, resolveAmountPaid } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

// Save a POS sale as a DRAFT: parks the cart as a Draft order on the `orders`
// spine WITHOUT deducting or holding any stock. Passing `oid` updates an
// existing Draft in place; omitting it creates a new one. Stock is only ever
// committed when the draft is finalized through checkout.
const save_pos_draft = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    const products = Array.isArray(payload.products) ? payload.products : [];

    if (!products.length) {
        return res.status(400).json({ code: 400, message: "At least one product line is required" });
    }

    // Light server-side batch validation (identity only; no stock is committed).
    const inventory_oids = [...new Set(products.map((p) => p.inventory_oid))];
    const inventoryRows = await get_data({
        text: `SELECT oid, product_oid FROM ${TABLE.INVENTORY} WHERE oid = ANY($1)`,
        values: [inventory_oids],
    });
    const byOid = new Map(inventoryRows.map((r) => [r.oid, r]));
    for (const p of products) {
        const batch = byOid.get(p.inventory_oid);
        if (!batch) return res.status(400).json({ code: 400, message: "One or more selected batches no longer exist" });
        if (batch.product_oid !== p.product_oid) return res.status(400).json({ code: 400, message: "Product/batch mismatch in payload" });
    }

    const subtotal = products.reduce((s, p) => s + Number(p.total || 0), 0);

    // Same rule as checkout, so a draft and the sale it becomes never disagree
    // about how much has been paid.
    const amount_paid = resolveAmountPaid({ payment_status: payload.payment_status || "paid", total_amount: payload.total_amount, amount_paid: payload.amount_paid });
    const isUpdate = Boolean(payload.oid);

    try {
        const saved = await execute_transaction(async (tx) => {
            let order_oid = payload.oid;
            let invoice_no = payload.invoice_no;

            if (isUpdate) {
                const existing = await tx.get_data({ text: `SELECT oid, status FROM ${TABLE.ORDERS} WHERE oid = $1 FOR UPDATE`, values: [order_oid] });
                if (!existing.length) fail(404, "Draft order not found");
                if (existing[0].status !== "Draft") fail(409, "Only draft orders can be edited");

                await tx.execute_value({
                    text: `UPDATE ${TABLE.ORDERS} SET
                              customer_name = $2, customer_phone = $3, customer_address = $4, customer_email = $5,
                              subtotal = $6, total_amount = $7,
                              payment_method = $8, payment_reference = $9, payment_status = $10, amount_paid = $11,
                              notes = $12, edited_by = $13, edited_on = NOW()
                            WHERE oid = $1`,
                    values: [
                        order_oid,
                        payload.customer_name || null, payload.customer_phone || null, payload.customer_address || null, payload.customer_email || null,
                        subtotal, payload.total_amount,
                        payload.payment_method, payload.payment_reference || null, payload.payment_status || "paid", amount_paid,
                        payload.notes || null, user_id,
                    ],
                });
                // Replace line items with the current cart.
                await tx.execute_value({ text: `DELETE FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`, values: [order_oid] });
            } else {
                order_oid = uuidv4();
                invoice_no = payload.invoice_no || (await nextInvoiceNo(tx.get_data));

                await tx.execute_value({
                    text: `INSERT INTO ${TABLE.ORDERS}
                             (oid, invoice_no, channel, order_type, customer_name, customer_phone, customer_address, customer_email,
                              subtotal, discount_total, delivery_charge, total_amount, amount_paid,
                              payment_type, payment_method, payment_reference, payment_status, status, notes, created_by)
                           VALUES ($1,$2,'POS','Standard',$3,$4,$5,$6,$7,0,0,$8,$9,NULL,$10,$11,$12,'Draft',$13,$14)`,
                    values: [
                        order_oid, invoice_no,
                        payload.customer_name || null, payload.customer_phone || null, payload.customer_address || null, payload.customer_email || null,
                        subtotal, payload.total_amount, amount_paid,
                        payload.payment_method, payload.payment_reference || null, payload.payment_status || "paid",
                        payload.notes || null, user_id,
                    ],
                });

                await recordStatusHistory(tx, { order_oid, from_status: null, to_status: "Draft", reason: "POS draft saved", user_id });
            }

            for (const p of products) {
                await tx.execute_value({
                    text: `INSERT INTO ${TABLE.ORDER_ITEMS}
                             (oid, order_oid, inventory_oid, product_oid, product_name, available_stock, quantity, unit_price, discount, total, returned_qty)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)`,
                    values: [uuidv4(), order_oid, p.inventory_oid, p.product_oid, p.product_name, p.quantity_available ?? null, p.quantity, p.unit_price, p.discount ?? 0, p.total],
                });
            }

            return { order_oid, invoice_no };
        });

        saveLogActivity({
            reference_type: "order",
            reference_oid: saved.order_oid,
            title: isUpdate ? "POS Draft Updated" : "POS Draft Saved",
            description: `POS draft ${saved.invoice_no} saved with ${products.length} line item(s)`,
            performed_by: user_id,
        });

        log.info(`POS draft ${saved.invoice_no} saved by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Draft saved successfully!", data: { oid: saved.order_oid, invoice_no: saved.invoice_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while saving POS draft: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = save_pos_draft;
