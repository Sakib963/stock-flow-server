const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");

// Takes a gift out of a parcel that has not left (giveaway REQ-04): its holds are released. The order
// row is locked first, as dispatch locks it, so a gift is never taken out while its units are leaving.
const remove_order_gift = async (request, res) => {
    const { oid } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const giveaway_no = await execute_transaction(async (tx) => {
            const [gift] = await tx.get_data({ text: `SELECT g.giveaway_no, g.order_oid, o.invoice_no FROM ${TABLE.GIVEAWAY} g LEFT JOIN ${TABLE.ORDERS} o ON o.oid = g.order_oid WHERE g.oid = $1`, values: [oid] });
            if (!gift?.order_oid) fail(404, "No gift on an order with that number.");
            await tx.get_data({ text: `SELECT 1 FROM ${TABLE.ORDERS} WHERE oid = $1 FOR UPDATE`, values: [gift.order_oid] });
            const removed = await tx.execute_value({
                text: `UPDATE ${TABLE.GIVEAWAY} SET status = 'Cancelled', cancel_reason = $1, edited_by = $2, edited_on = clock_timestamp() WHERE oid = $3 AND status = 'Held'`,
                values: [`Taken out of ${gift.invoice_no}`, user_id, oid],
            });
            if (removed.rowCount !== 1) {
                const [now] = await tx.get_data({ text: `SELECT status FROM ${TABLE.GIVEAWAY} WHERE oid = $1`, values: [oid] });
                fail(409, `${gift.giveaway_no} is already ${now.status === "Cancelled" ? "taken out" : "gone with the parcel"}. Reload to see what changed.`, { status: now.status });
            }
            await tx.execute_value({
                text: `UPDATE ${TABLE.STOCK_HOLD} SET status = 'Released', edited_by = $1, edited_on = clock_timestamp()
                        WHERE status = 'Active' AND giveaway_line_oid IN (SELECT oid FROM ${TABLE.GIVEAWAY_LINE} WHERE giveaway_oid = $2)`,
                values: [user_id, oid],
            });
            await saveLogActivity({ reference_type: "giveaway", reference_oid: oid, title: "Gift taken out of the order", description: `${gift.giveaway_no} taken out of ${gift.invoice_no}` }, { tx, request });
            await saveLogActivity({ reference_type: "order", reference_oid: gift.order_oid, title: "Gift removed", description: `${gift.giveaway_no} taken out` }, { tx, request });
            return gift.giveaway_no;
        });
        log.info(`Gift ${giveaway_no} removed from its order by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Gift removed", data: { oid, giveaway_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while removing a gift from an order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The gift was not removed. Try again in a moment." });
    }
};

module.exports = remove_order_gift;
