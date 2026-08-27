const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../utils/database");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

// Edit a pre-order (FR-16):
//   Pending   -> fully editable, line items included
//   Confirmed -> money fields and customer contact only; lines are frozen
//   terminal  -> read-only
const update_pre_order_details = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    const products = Array.isArray(payload.products) ? payload.products : [];

    try {
        const { current, discount_total, delivery_charge, advance_paid } = await execute_transaction(async (tx) => {
            const currentRows = await tx.get_data({
                text: `SELECT preorder_no, status, customer_name, customer_phone, customer_email, customer_address,
                              CAST(discount_total AS INTEGER) AS discount_total,
                              CAST(delivery_charge AS INTEGER) AS delivery_charge,
                              CAST(advance_paid AS INTEGER) AS advance_paid,
                              expected_date, notes
                         FROM ${TABLE.PRE_ORDERS} WHERE oid = $1 FOR UPDATE`,
                values: [payload.oid],
            });

            if (!currentRows.length) fail(404, "Pre-order not found");
            const current = currentRows[0];

            if (current.status === "Converted" || current.status === "Cancelled") {
                fail(409, `A ${current.status} pre-order can no longer be edited`);
            }

            const linesEditable = current.status === "Pending";

            // Totals only move when the lines can move; otherwise keep the booked subtotal.
            let subtotal;
            if (linesEditable) {
                if (!products.length) fail(400, "At least one product line is required");
                subtotal = products.reduce((s, p) => s + Number(p.total || 0), 0);
            } else {
                const sub = await tx.get_data({
                    text: `SELECT COALESCE(SUM(total), 0)::int AS subtotal FROM ${TABLE.PRE_ORDER_ITEMS} WHERE pre_order_oid = $1`,
                    values: [payload.oid],
                });
                subtotal = Number(sub[0].subtotal);
            }

            const discount_total = Number(payload.discount_total || 0);
            const delivery_charge = Number(payload.delivery_charge || 0);
            const total_amount = subtotal - discount_total + delivery_charge;
            const advance_paid = Number(payload.advance_paid || 0);

            if (advance_paid > total_amount) fail(400, "Advance paid cannot be more than the pre-order total");

            await tx.execute_value({
                text: `UPDATE ${TABLE.PRE_ORDERS}
                          SET customer_name = $1, customer_phone = $2, customer_email = $3, customer_address = $4,
                              delivery_city = $5, delivery_zone = $6, delivery_area = $7, delivery_postcode = $8,
                              subtotal = $9, discount_total = $10, delivery_charge = $11, total_amount = $12,
                              advance_paid = $13, advance_method = $14, advance_reference = $15,
                              expected_date = $16, notes = $17,
                              edited_by = $18, edited_on = clock_timestamp()
                        WHERE oid = $19`,
                values: [
                    payload.customer_name,
                    payload.customer_phone,
                    payload.customer_email || null,
                    payload.customer_address || null,
                    payload.delivery_city || null,
                    payload.delivery_zone || null,
                    payload.delivery_area || null,
                    payload.delivery_postcode || null,
                    subtotal,
                    discount_total,
                    delivery_charge,
                    total_amount,
                    advance_paid,
                    payload.advance_method || null,
                    payload.advance_reference || null,
                    payload.expected_date || null,
                    payload.notes || null,
                    user_id,
                    payload.oid,
                ],
            });

            if (linesEditable) {
                await tx.execute_value({ text: `DELETE FROM ${TABLE.PRE_ORDER_ITEMS} WHERE pre_order_oid = $1`, values: [payload.oid] });
                for (const p of products) {
                    await tx.execute_value({
                        text: `INSERT INTO ${TABLE.PRE_ORDER_ITEMS}
                                 (oid, pre_order_oid, product_oid, product_name, quantity, unit_price, discount, total)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                        values: [uuidv4(), payload.oid, p.product_oid, p.product_name, p.quantity, p.unit_price, p.discount ?? 0, p.total],
                    });
                }
            }

            return { current, discount_total, delivery_charge, advance_paid };
        });

        // With no payments ledger, the activity log is the ONLY audit trail for
        // money on a pre-order, so advance changes must always be described.
        const changes = detectChanges(current, {
            customer_name: payload.customer_name,
            customer_phone: payload.customer_phone,
            customer_email: payload.customer_email || null,
            customer_address: payload.customer_address || null,
            discount_total,
            delivery_charge,
            advance_paid,
            notes: payload.notes || null,
        });
        const description = generateChangeDescription(`pre-order ${current.preorder_no}`, changes);

        saveLogActivity({
            reference_type: "pre_order",
            reference_oid: payload.oid,
            title: "Updated pre-order",
            performed_by: user_id,
            description,
        });

        log.info(`Pre-order ${current.preorder_no} updated by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Pre-Order Updated Successfully!" });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while updating pre-order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = update_pre_order_details;
