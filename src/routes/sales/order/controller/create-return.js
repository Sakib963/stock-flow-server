const crypto = require("crypto");
const { TABLE } = require("../../../../utils/constant");
const pool = require("../../../../utils/db.config");
const { get_data } = require("../../../../utils/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { restockStock, incrementProductStat } = require("../../../../utils/stock-movement");
const { recordStatusHistory } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");

// Process a return against a DELIVERED (or already partially-returned) order.
// Partial or full. Per returned line: Good -> restock to sellable; Damaged ->
// Product Disposal entry, no restock. Optional delivery-charge refund toggle.
// Money is settled outside the app -- refund_amount is recorded as intent only.
const create_return = async (request, res) => {
    const user_id = request.credentials.user_id;
    const { order_oid, refund_delivery_charge = false, note } = request.body;
    const items = Array.isArray(request.body.items) ? request.body.items : [];
    if (!items.length) return res.status(400).json({ code: 400, message: "At least one return line is required" });

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const orderRes = await client.query({
            text: `SELECT invoice_no, status, CAST(delivery_charge AS INTEGER) AS delivery_charge FROM ${TABLE.ORDERS} WHERE oid = $1 FOR UPDATE`,
            values: [order_oid],
        });
        if (!orderRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ code: 404, message: "Order not found" }); }
        const order = orderRes.rows[0];
        if (!["Delivered", "PartiallyReturned"].includes(order.status)) {
            await client.query("ROLLBACK");
            return res.status(409).json({ code: 409, message: "Only delivered orders can be returned" });
        }

        const lineRows = await client.query({
            text: `SELECT oid, product_oid, inventory_oid, product_name, CAST(quantity AS INTEGER) AS quantity,
                          CAST(returned_qty AS INTEGER) AS returned_qty, CAST(unit_price AS INTEGER) AS unit_price
                     FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`,
            values: [order_oid],
        });
        const lineByOid = new Map(lineRows.rows.map((r) => [r.oid, r]));

        // Validate every requested return line.
        const validated = [];
        for (const it of items) {
            const line = lineByOid.get(it.order_item_oid);
            if (!line) { await client.query("ROLLBACK"); return res.status(400).json({ code: 400, message: "A return line does not belong to this order" }); }
            if (!["Good", "Damaged"].includes(it.condition)) { await client.query("ROLLBACK"); return res.status(400).json({ code: 400, message: "Each line must be Good or Damaged" }); }
            const remaining = line.quantity - line.returned_qty;
            if (!(it.quantity > 0) || it.quantity > remaining) {
                await client.query("ROLLBACK");
                return res.status(400).json({ code: 400, message: `Cannot return ${it.quantity} of "${line.product_name}" (only ${remaining} remain)` });
            }
            if (!line.inventory_oid) { await client.query("ROLLBACK"); return res.status(400).json({ code: 400, message: `"${line.product_name}" has no batch to return against` }); }
            validated.push({ ...it, line });
        }

        const items_refund = validated.reduce((s, v) => s + v.quantity * v.line.unit_price, 0);
        const refund_amount = items_refund + (refund_delivery_charge ? order.delivery_charge : 0);

        // Unique return reference.
        const priorReturns = await client.query({ text: `SELECT COUNT(*)::int AS n FROM ${TABLE.PRODUCT_RETURN} WHERE order_oid = $1`, values: [order_oid] });
        const return_no = `${order.invoice_no}-R${priorReturns.rows[0].n + 1}`;
        const return_oid = uuidv4();
        await client.query({
            text: `INSERT INTO ${TABLE.PRODUCT_RETURN} (oid, order_oid, invoice_no, refund_amount, refund_delivery_charge, return_reason, status, created_by)
                   VALUES ($1,$2,$3,$4,$5,$6,'Returned',$7)`,
            values: [return_oid, order_oid, return_no, refund_amount, !!refund_delivery_charge, note || null, user_id],
        });

        // Damaged lines route to a single Product Disposal document (already approved:
        // the stock left inventory at dispatch, so no further deduction -- this records
        // the write-off + damaged analytics). Good lines restock to sellable.
        const damaged = validated.filter((v) => v.condition === "Damaged");
        let dispose_oid = null;
        if (damaged.length) {
            const invRows = await get_data({ text: `SELECT oid, CAST(cost_price AS INTEGER) AS cost_price FROM ${TABLE.INVENTORY} WHERE oid = ANY($1)`, values: [[...new Set(damaged.map((d) => d.line.inventory_oid))]] });
            const costByInv = new Map(invRows.map((r) => [r.oid, r.cost_price]));
            const total_qty = damaged.reduce((s, d) => s + d.quantity, 0);
            const total_value = damaged.reduce((s, d) => s + d.quantity * (costByInv.get(d.line.inventory_oid) || 0), 0);
            dispose_oid = uuidv4();
            const dispose_no = `DISP-R-${Date.now().toString(36).toUpperCase()}`;
            await client.query({
                text: `INSERT INTO ${TABLE.PRODUCT_DISPOSE} (oid, dispose_no, disposal_date, disposal_method, total_dispose_quantity, total_dispose_value, notes, status, approved_by, approved_on, created_by)
                       VALUES ($1,$2,CURRENT_DATE,'destroy',$3,$4,$5,'Approved',$6,clock_timestamp(),$6)`,
                values: [dispose_oid, dispose_no, total_qty, total_value, `Damaged customer return for order ${order.invoice_no}`, user_id],
            });
            for (const d of damaged) {
                await client.query({
                    text: `INSERT INTO ${TABLE.DISPOSE_DETAILS} (oid, dispose_oid, product_oid, inventory_oid, dispose_quantity, reason, cost_price, line_note, created_by)
                           VALUES ($1,$2,$3,$4,$5,'damaged',$6,$7,$8)`,
                    values: [uuidv4(), dispose_oid, d.line.product_oid, d.line.inventory_oid, d.quantity, costByInv.get(d.line.inventory_oid) || 0, `Return of ${return_no}`, user_id],
                });
            }
        }

        for (const v of validated) {
            const action = v.condition === "Good" ? "Restocked" : "Disposed";
            await client.query({
                text: `INSERT INTO ${TABLE.RETURN_DETAILS} (oid, return_oid, order_item_oid, product_oid, inventory_oid, return_quantity, condition, action, dispose_oid)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                values: [uuidv4(), return_oid, v.line.oid, v.line.product_oid, v.line.inventory_oid, v.quantity, v.condition, action, v.condition === "Damaged" ? dispose_oid : null],
            });
            await client.query({ text: `UPDATE ${TABLE.ORDER_ITEMS} SET returned_qty = returned_qty + $1 WHERE oid = $2`, values: [v.quantity, v.line.oid] });

            if (v.condition === "Good") {
                await restockStock(client, { inventory_oid: v.line.inventory_oid, quantity: v.quantity, user_id });
                await incrementProductStat(client, { product_oid: v.line.product_oid, column: "total_returned", quantity: v.quantity, user_id });
            } else {
                await incrementProductStat(client, { product_oid: v.line.product_oid, column: "total_damaged", quantity: v.quantity, user_id });
            }
        }

        // Full vs partial: fully returned iff every line's returned_qty == quantity.
        const remainingRes = await client.query({ text: `SELECT COALESCE(SUM(quantity - returned_qty), 0)::int AS remaining FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`, values: [order_oid] });
        const new_status = remainingRes.rows[0].remaining === 0 ? "Returned" : "PartiallyReturned";
        await client.query({ text: `UPDATE ${TABLE.ORDERS} SET status = $1, tracking_token = COALESCE(tracking_token, $4), edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3`, values: [new_status, user_id, order_oid, crypto.randomBytes(16).toString("hex")] });
        await recordStatusHistory(client, { order_oid, from_status: order.status, to_status: new_status, reason: `Return ${return_no} (refund intent ${refund_amount})`, user_id });

        await client.query("COMMIT");

        saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Return Processed", description: `${return_no}: ${validated.length} line(s), refund intent ${refund_amount}${damaged.length ? `, ${damaged.length} damaged -> disposal` : ""}`, performed_by: user_id });
        log.info(`Return ${return_no} processed by ${user_id}; new status ${new_status}`);
        return res.status(200).json({ code: 200, message: "Return processed", data: { return_oid, return_no, refund_amount, order_status: new_status, dispose_oid } });
    } catch (e) {
        try { await client.query("ROLLBACK"); } catch (r) { log.error(`Rollback failed on return: ${r?.message}`); }
        log.error(`An exception occurred while processing return: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    } finally {
        client.release();
    }
};

module.exports = create_return;
