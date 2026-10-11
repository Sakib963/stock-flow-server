const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { business_number } = require("../../../../utils/business-time");
const { holdStock } = require("../../utils/stock-movement");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// A gift in an online order's parcel (giveaway REQ-03): held with the order's stock from free units,
// to the order's customer and address. The order row is locked first, as dispatch and cancel lock it,
// so a gift is never added to a parcel that is leaving or being cancelled at the same moment.
const add_order_gift = async (request, res) => {
    const { oid, order_oid, note, lines } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const giveaway_no = await execute_transaction(async (tx) => {
            const [order] = await tx.get_data({
                text: `SELECT o.invoice_no, o.status, o.dispatched_on, o.customer_oid, o.customer_name, o.customer_phone, oo.recipient_name, oo.recipient_phone, oo.address_line
                         FROM ${TABLE.ORDERS} o JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
                        WHERE o.oid = $1 AND o.channel = 'ONLINE' FOR UPDATE OF o`,
                values: [order_oid],
            });
            if (!order) fail(404, "No online order with that number.");
            const [already] = await tx.get_data({ text: `SELECT giveaway_no, order_oid FROM ${TABLE.GIVEAWAY} WHERE oid = $1`, values: [oid] });
            if (already) {
                if (already.order_oid !== order_oid) fail(409, "That giveaway number is already taken. Reload the page and try again.");
                return already.giveaway_no;
            }
            if (!["Pending", "Confirmed"].includes(order.status) || order.dispatched_on) fail(409, `${order.invoice_no} has left or is closed. Send the gift on its own.`, { status: order.status });

            const batches = await tx.get_data({
                text: `SELECT i.oid, i.product_oid, i.cost_price::int AS cost_price, p.name
                         FROM ${TABLE.INVENTORY} i JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
                        WHERE i.oid = ANY($1) AND COALESCE(p.is_deleted, false) = false`,
                values: [lines.map((line) => line.inventory_oid)],
            });
            if (batches.length !== lines.length) fail(409, "A product on this gift was deleted or its batch no longer exists. Remove it and pick again.");
            const by_oid = new Map(batches.map((batch) => [batch.oid, batch]));

            const [{ giveaway_no }] = await tx.get_data({
                text: `INSERT INTO ${TABLE.GIVEAWAY} (oid, giveaway_no, customer_oid, order_oid, recipient_name, recipient_phone, address_line, note, status, created_by)
                       VALUES ($1, ${business_number("GFT", "giveaway_number_seq")}, $2, $3, $4, $5, $6, $7, 'Held', $8) RETURNING giveaway_no`,
                values: [oid, order.customer_oid, order_oid, order.recipient_name || order.customer_name || order.invoice_no, order.recipient_phone || order.customer_phone, order.address_line, note, user_id],
            });
            for (const line of [...lines].sort((a, b) => a.inventory_oid.localeCompare(b.inventory_oid))) {
                const batch = by_oid.get(line.inventory_oid);
                const line_oid = uuidv4();
                await tx.execute_value({
                    text: `INSERT INTO ${TABLE.GIVEAWAY_LINE} (oid, giveaway_oid, inventory_oid, product_oid, quantity, cost_price) VALUES ($1, $2, $3, $4, $5, $6)`,
                    values: [line_oid, oid, line.inventory_oid, batch.product_oid, line.quantity, batch.cost_price],
                });
                const hold = await holdStock(tx, { order_oid, giveaway_line_oid: line_oid, product_oid: batch.product_oid, inventory_oid: line.inventory_oid, quantity: line.quantity, user_id });
                if (!hold.ok) fail(409, `Only ${Math.max(0, hold.sellable)} ${batch.name} free to give. Units held for other orders cannot be given.`, { inventory_oid: line.inventory_oid, sellable: hold.sellable });
            }
            await saveLogActivity({ reference_type: "giveaway", reference_oid: oid, title: "Gift added to an order", description: `${giveaway_no} in ${order.invoice_no}, ${lines.length} line(s)` }, { tx, request });
            await saveLogActivity({ reference_type: "order", reference_oid: order_oid, title: "Gift added", description: `${giveaway_no} in ${order.invoice_no}` }, { tx, request });
            return giveaway_no;
        });
        log.info(`Gift ${giveaway_no} added to order ${order_oid} by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Gift added", data: { oid, giveaway_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while adding a gift to an order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The gift was not added. Try again in a moment." });
    }
};

module.exports = add_order_gift;
