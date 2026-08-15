const { TABLE } = require("../../../../utils/constant");
const pool = require("../../../../utils/db.config");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { holdStock } = require("../../../../utils/stock-movement");
const { recordStatusHistory } = require("../../../../utils/order-utils");
const { log } = require("../../../../utils/log");

// Convert a PRE-ORDER into a normal in-stock order once stock has arrived.
// Admin assigns a now-available batch to each line; we hold the stock atomically
// and flip order_type to Standard (stays Pending -> then follows the normal flow).
// Blocked if any line's stock is still insufficient.
const convert_preorder = async (request, res) => {
    const user_id = request.credentials.user_id;
    const order_oid = request.body.oid;
    const assignments = new Map((request.body.items || []).map((i) => [i.order_item_oid, i.inventory_oid]));

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const orderRes = await client.query({ text: `SELECT invoice_no, order_type, status FROM ${TABLE.ORDERS} WHERE oid = $1 FOR UPDATE`, values: [order_oid] });
        if (!orderRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ code: 404, message: "Order not found" }); }
        const order = orderRes.rows[0];
        if (order.order_type !== "Preorder" || order.status !== "Pending") {
            await client.query("ROLLBACK");
            return res.status(409).json({ code: 409, message: "Only a Pending pre-order can be converted" });
        }

        const items = await client.query({ text: `SELECT oid, product_oid, product_name, CAST(quantity AS INTEGER) AS quantity FROM ${TABLE.ORDER_ITEMS} WHERE order_oid = $1`, values: [order_oid] });

        for (const item of items.rows) {
            const inventory_oid = assignments.get(item.oid);
            if (!inventory_oid) { await client.query("ROLLBACK"); return res.status(400).json({ code: 400, message: `Assign a batch for "${item.product_name}"` }); }

            const batch = await client.query({ text: `SELECT product_oid, intended_use, status FROM ${TABLE.INVENTORY} WHERE oid = $1`, values: [inventory_oid] });
            if (!batch.rowCount || batch.rows[0].product_oid !== item.product_oid || batch.rows[0].intended_use !== "for_sale" || batch.rows[0].status !== "ready_for_sale") {
                await client.query("ROLLBACK");
                return res.status(400).json({ code: 400, message: `Invalid batch for "${item.product_name}"` });
            }

            const hold = await holdStock(client, { order_oid, order_item_oid: item.oid, product_oid: item.product_oid, inventory_oid, quantity: item.quantity, user_id });
            if (!hold.ok) {
                await client.query("ROLLBACK");
                return res.status(409).json({ code: 409, message: `Not enough stock to convert "${item.product_name}" (need ${item.quantity}, ${hold.sellable} sellable)` });
            }
            await client.query({ text: `UPDATE ${TABLE.ORDER_ITEMS} SET inventory_oid = $1 WHERE oid = $2`, values: [inventory_oid, item.oid] });
        }

        await client.query({ text: `UPDATE ${TABLE.ORDERS} SET order_type = 'Standard', edited_by = $1, edited_on = clock_timestamp() WHERE oid = $2`, values: [user_id, order_oid] });
        await recordStatusHistory(client, { order_oid, from_status: "Pending", to_status: "Pending", reason: "Pre-order converted to in-stock; stock held", user_id });
        await client.query("COMMIT");

        saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Pre-Order Converted", description: `Pre-order ${order.invoice_no} converted to in-stock; stock held`, performed_by: user_id });
        log.info(`Pre-order ${order_oid} converted by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Pre-order converted; stock held" });
    } catch (e) {
        try { await client.query("ROLLBACK"); } catch (r) { log.error(`Rollback failed on convert: ${r?.message}`); }
        log.error(`An exception occurred while converting pre-order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    } finally {
        client.release();
    }
};

module.exports = convert_preorder;
