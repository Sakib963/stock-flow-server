const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail, get_data } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { holdStock } = require("../../../../utils/stock-movement");
const { recordStatusHistory } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

// Edit an online order while it is still PENDING. Re-runs the hold math atomically
// (release old holds, re-hold the new lines). Locks once Confirmed/dispatched.
// Works for Standard pending orders (re-holds stock).
const edit_pending_order = async (request, res) => {
    const user_id = request.credentials.user_id;
    const { oid, customer } = request.body;
    const products = Array.isArray(request.body.products) ? request.body.products : [];
    if (!products.length) return res.status(400).json({ code: 400, message: "At least one product line is required" });

    try {
        await execute_transaction(async (tx) => {
            const ordRows = await tx.get_data({ text: `SELECT channel, order_type, status, customer_oid, customer_address FROM ${TABLE.ORDERS} WHERE oid = $1 FOR UPDATE`, values: [oid] });
            if (!ordRows.length) fail(404, "Order not found");
            const order = ordRows[0];
            if (order.channel !== "ONLINE" || order.status !== "Pending") fail(409, "Only Pending online orders can be edited");
            const isStandard = order.order_type === "Standard";

            // Validate lines.
            if (isStandard) {
                if (products.some((p) => !p.inventory_oid)) fail(400, "Each in-stock line needs a batch");
                const invOids = [...new Set(products.map((p) => p.inventory_oid))];
                const invRows = await get_data({ text: `SELECT oid, product_oid, intended_use, status FROM ${TABLE.INVENTORY} WHERE oid = ANY($1)`, values: [invOids] });
                const byOid = new Map(invRows.map((r) => [r.oid, r]));
                for (const p of products) {
                    const b = byOid.get(p.inventory_oid);
                    if (!b || b.product_oid !== p.product_oid || b.intended_use !== "for_sale" || b.status !== "ready_for_sale") fail(400, `Invalid batch for "${p.product_name}"`);
                }
            }

            // Release existing holds and detach them from items so items can be replaced.
            await tx.execute_value({
                text: `UPDATE ${TABLE.STOCK_HOLD}
                          SET order_item_oid = NULL,
                              status = CASE WHEN status = 'Active' THEN 'Released' ELSE status END,
                              edited_by = $1, edited_on = clock_timestamp()
                        WHERE order_oid = $2`,
                values: [user_id, oid],
            });
            await tx.execute_value({ text: `DELETE FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`, values: [oid] });

            // Re-insert lines and (for Standard) re-hold.
            for (const p of products) {
                const item_oid = uuidv4();
                await tx.execute_value({
                    text: `INSERT INTO ${TABLE.ORDER_ITEMS} (oid, order_oid, inventory_oid, product_oid, product_name, available_stock, quantity, unit_price, discount, total, returned_qty)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)`,
                    values: [item_oid, oid, isStandard ? p.inventory_oid : null, p.product_oid, p.product_name, p.quantity_available ?? null, p.quantity, p.unit_price, p.discount ?? 0, p.total],
                });
                if (isStandard) {
                    const hold = await holdStock(tx, { order_oid: oid, order_item_oid: item_oid, product_oid: p.product_oid, inventory_oid: p.inventory_oid, quantity: p.quantity, user_id });
                    if (!hold.ok) fail(409, `Not enough sellable stock to hold "${p.product_name}" (need ${p.quantity}, ${hold.sellable} sellable)`);
                }
            }

            const subtotal = products.reduce((s, p) => s + Number(p.total || 0), 0);
            const discount_total = request.body.discount_total !== undefined ? Number(request.body.discount_total) : null;
            const delivery_charge = request.body.delivery_charge !== undefined ? Number(request.body.delivery_charge) : null;

            // Update order header (COALESCE keeps existing when a field is omitted).
            await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS}
                          SET subtotal = $1,
                              discount_total = COALESCE($2, discount_total),
                              delivery_charge = COALESCE($3, delivery_charge),
                              total_amount = $1 - COALESCE($2, discount_total) + COALESCE($3, delivery_charge),
                              customer_name = COALESCE($4, customer_name),
                              customer_phone = COALESCE($5, customer_phone),
                              customer_address = COALESCE($6, customer_address),
                              delivery_city = COALESCE($7, delivery_city),
                              delivery_zone = COALESCE($8, delivery_zone),
                              delivery_area = COALESCE($9, delivery_area),
                              delivery_postcode = COALESCE($10, delivery_postcode),
                              payment_status = COALESCE($11, payment_status),
                              amount_paid = COALESCE($12, amount_paid),
                              notes = COALESCE($13, notes),
                              edited_by = $14, edited_on = clock_timestamp()
                        WHERE oid = $15`,
                values: [
                    subtotal, discount_total, delivery_charge,
                    customer?.name ?? null, customer?.phone ?? null, customer?.address ?? null,
                    customer?.city ?? null, customer?.zone ?? null, customer?.area ?? null, customer?.postcode ?? null,
                    request.body.payment_status ?? null, request.body.amount_paid ?? null,
                    request.body.note ?? null, user_id, oid,
                ],
            });
            if (customer && order.customer_oid) {
                await tx.execute_value({
                    text: `UPDATE ${TABLE.CUSTOMERS}
                              SET name = COALESCE($1,name), phone = COALESCE($2,phone), address = COALESCE($3,address),
                                  city = COALESCE($4,city), zone = COALESCE($5,zone), area = COALESCE($6,area), postcode = COALESCE($7,postcode),
                                  edited_by = $8, edited_on = clock_timestamp()
                            WHERE oid = $9`,
                    values: [customer.name ?? null, customer.phone ?? null, customer.address ?? null, customer.city ?? null, customer.zone ?? null, customer.area ?? null, customer.postcode ?? null, user_id, order.customer_oid],
                });
            }

            await recordStatusHistory(tx, { order_oid: oid, from_status: "Pending", to_status: "Pending", reason: "Pending order edited; holds re-run", user_id });
        });

        saveLogActivity({ reference_type: "order", reference_oid: oid, title: "Order Edited", description: `Pending order edited (${products.length} line(s)); holds re-run`, performed_by: user_id });
        log.info(`Pending order ${oid} edited by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Order updated", data: { oid } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while editing pending order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = edit_pending_order;
