const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, get_data } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordPreOrderStatusHistory, nextPreOrderNo } = require("../../../../utils/pre-order-utils");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

// Create a pre-order: a booking for stock the shop does not hold.
//   - ANY active product is selectable, in stock or not (FR-1)
//   - lines reference a PRODUCT, never a batch (FR-2)
//   - NO stock is held, reserved or deducted (FR-3)
//   - delivery address is optional at booking (FR-5)
const create_pre_order = async (request, res) => {
    const payload = request.body;
    const user_id = request.credentials.user_id;
    const products = Array.isArray(payload.products) ? payload.products : [];

    if (!products.length) {
        return res.status(400).json({ code: 400, message: "At least one product line is required" });
    }

    // Products must exist. Note we check `product`, NOT `inventory` -- a pre-order
    // is precisely for products with no sellable batch.
    const product_oids = [...new Set(products.map((p) => p.product_oid))];
    const found = await get_data({
        text: `SELECT oid FROM ${TABLE.PRODUCT} WHERE oid = ANY($1) AND is_deleted = FALSE`,
        values: [product_oids],
    });
    if (found.length !== product_oids.length) {
        return res.status(400).json({ code: 400, message: "One or more selected products no longer exist" });
    }

    const subtotal = products.reduce((s, p) => s + Number(p.total || 0), 0);
    const discount_total = Number(payload.discount_total || 0);
    const delivery_charge = Number(payload.delivery_charge || 0);
    const total_amount = subtotal - discount_total + delivery_charge;
    const advance_paid = Number(payload.advance_paid || 0);

    if (advance_paid > total_amount) {
        return res.status(400).json({ code: 400, message: "Advance paid cannot be more than the pre-order total" });
    }

    const pre_order_oid = uuidv4();

    try {
        const preorder_no = await execute_transaction(async (tx) => {
            const preorder_no = payload.preorder_no || (await nextPreOrderNo(tx.get_data));

            await tx.execute_value({
                text: `INSERT INTO ${TABLE.PRE_ORDERS}
                         (oid, preorder_no, customer_name, customer_phone, customer_email, customer_address,
                          delivery_city, delivery_zone, delivery_area, delivery_postcode,
                          subtotal, discount_total, delivery_charge, total_amount,
                          advance_paid, advance_method, advance_reference,
                          expected_date, status, notes, created_by)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'Pending',$19,$20)`,
                values: [
                    pre_order_oid,
                    preorder_no,
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
                ],
            });

            for (const p of products) {
                await tx.execute_value({
                    text: `INSERT INTO ${TABLE.PRE_ORDER_ITEMS}
                             (oid, pre_order_oid, product_oid, product_name, quantity, unit_price, discount, total)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                    values: [uuidv4(), pre_order_oid, p.product_oid, p.product_name, p.quantity, p.unit_price, p.discount ?? 0, p.total],
                });
            }

            await recordPreOrderStatusHistory(tx, {
                pre_order_oid,
                from_status: null,
                to_status: "Pending",
                reason: "Pre-order booked (no stock held)",
                user_id,
            });

            return preorder_no;
        });

        saveLogActivity({
            reference_type: "pre_order",
            reference_oid: pre_order_oid,
            title: "Created pre-order",
            performed_by: user_id,
            description: `Created pre-order ${preorder_no} for "${payload.customer_name}" with ${products.length} item(s), advance ${advance_paid}`,
        });

        log.info(`Pre-order ${preorder_no} created by ${user_id}`);
        return res.status(200).json({
            code: 200,
            message: "Pre-Order Created Successfully!",
            data: { oid: pre_order_oid, preorder_no },
        });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });
        log.error(`An exception occurred while creating pre-order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = create_pre_order;
