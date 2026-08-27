const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail, get_data } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { deductSellableStock, incrementProductStat } = require("../../../../utils/stock-movement");
const { recordStatusHistory, nextInvoiceNo } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

// POS checkout: create (or finalize an existing Draft into) a CLOSED order
// (channel POS, status Purchased) and deduct stock immediately -- no hold, no
// delivery step. When `oid` is present the order is an existing POS Draft being
// turned into a real sale, so we update it in place instead of inserting a new
// row. Everything runs in ONE transaction with a guarded deduct so stock and
// order state never diverge and the last unit can't be oversold under concurrency.
const checkout_pos_sale = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    const products = Array.isArray(payload.products) ? payload.products : [];

    if (!products.length) {
        return res.status(400).json({ code: 400, message: "At least one product line is required" });
    }

    // Validate batches server-side (never trust client on stock/pricing identity).
    const inventory_oids = [...new Set(products.map((p) => p.inventory_oid))];
    const inventoryRows = await get_data({
        text: `SELECT oid, product_oid, intended_use, status FROM ${TABLE.INVENTORY} WHERE oid = ANY($1)`,
        values: [inventory_oids],
    });
    const byOid = new Map(inventoryRows.map((r) => [r.oid, r]));
    for (const p of products) {
        const batch = byOid.get(p.inventory_oid);
        if (!batch) return res.status(400).json({ code: 400, message: "One or more selected batches no longer exist" });
        if (batch.product_oid !== p.product_oid) return res.status(400).json({ code: 400, message: "Product/batch mismatch in payload" });
        if (batch.intended_use !== "for_sale" || batch.status !== "ready_for_sale") {
            return res.status(400).json({ code: 400, message: "One or more batches are not available for sale" });
        }
    }

    const subtotal = products.reduce((s, p) => s + Number(p.total || 0), 0);
    const isFinalizingDraft = Boolean(payload.oid);

    try {
        const sale = await execute_transaction(async (tx) => {
            let order_oid = payload.oid;
            let invoice_no = payload.invoice_no;
            let from_status = null;

            if (isFinalizingDraft) {
                // Turn an existing POS Draft into a real sale; it must still be a Draft.
                const existing = await tx.get_data({ text: `SELECT oid, status, invoice_no FROM ${TABLE.ORDERS} WHERE oid = $1 FOR UPDATE`, values: [order_oid] });
                if (!existing.length) fail(404, "Draft order not found");
                if (existing[0].status !== "Draft") fail(409, "This order has already been finalized");
                invoice_no = existing[0].invoice_no;
                from_status = "Draft";

                await tx.execute_value({
                    text: `UPDATE ${TABLE.ORDERS} SET
                              customer_name = $2, customer_phone = $3, customer_address = $4, customer_email = $5,
                              subtotal = $6, total_amount = $7,
                              payment_method = $8, payment_reference = $9, payment_status = $10,
                              status = 'Purchased', notes = $11, edited_by = $12, edited_on = NOW()
                            WHERE oid = $1`,
                    values: [
                        order_oid,
                        payload.customer_name || null, payload.customer_phone || null, payload.customer_address || null, payload.customer_email || null,
                        subtotal, payload.total_amount,
                        payload.payment_method, payload.payment_reference || null, payload.payment_status || "paid",
                        payload.notes || null, user_id,
                    ],
                });
                // Replace line items (the cashier may have edited the draft).
                await tx.execute_value({ text: `DELETE FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`, values: [order_oid] });
            } else {
                order_oid = uuidv4();
                invoice_no = payload.invoice_no || (await nextInvoiceNo(tx.get_data));

                await tx.execute_value({
                    text: `INSERT INTO ${TABLE.ORDERS}
                             (oid, invoice_no, channel, order_type, customer_name, customer_phone, customer_address, customer_email,
                              subtotal, discount_total, delivery_charge, total_amount,
                              payment_type, payment_method, payment_reference, payment_status, status, notes, created_by)
                           VALUES ($1,$2,'POS','Standard',$3,$4,$5,$6,$7,0,0,$8,NULL,$9,$10,$11,'Purchased',$12,$13)`,
                    values: [
                        order_oid, invoice_no,
                        payload.customer_name || null, payload.customer_phone || null, payload.customer_address || null, payload.customer_email || null,
                        subtotal, payload.total_amount,
                        payload.payment_method, payload.payment_reference || null, payload.payment_status || "paid",
                        payload.notes || null, user_id,
                    ],
                });
            }

            for (const p of products) {
                await tx.execute_value({
                    text: `INSERT INTO ${TABLE.ORDER_ITEMS}
                             (oid, order_oid, inventory_oid, product_oid, product_name, available_stock, quantity, unit_price, discount, total, returned_qty)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)`,
                    values: [uuidv4(), order_oid, p.inventory_oid, p.product_oid, p.product_name, p.quantity_available ?? null, p.quantity, p.unit_price, p.discount ?? 0, p.total],
                });

                const ok = await deductSellableStock(tx, { inventory_oid: p.inventory_oid, quantity: p.quantity, user_id });
                if (!ok) fail(409, `Insufficient sellable stock for "${p.product_name}". Nothing was charged.`);

                await incrementProductStat(tx, { product_oid: p.product_oid, column: "total_sold", quantity: p.quantity, user_id });
            }

            await recordStatusHistory(tx, { order_oid, from_status, to_status: "Purchased", reason: isFinalizingDraft ? "POS draft finalized" : "POS checkout", user_id });
            return { order_oid, invoice_no };
        });

        saveLogActivity({
            reference_type: "order",
            reference_oid: sale.order_oid,
            title: "POS Sale Completed",
            description: `POS sale ${sale.invoice_no} for ${products.length} line item(s), total ${payload.total_amount}`,
            performed_by: user_id,
        });

        log.info(`POS sale ${sale.invoice_no} completed by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Sale completed successfully!", data: { oid: sale.order_oid, invoice_no: sale.invoice_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred during POS checkout: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = checkout_pos_sale;
