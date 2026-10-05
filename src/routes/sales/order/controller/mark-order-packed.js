const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { recordStatusHistory } = require("../../utils/order-utils");
const { refuse_change } = require("../utils/order-state");

// Packed (sales REQ-111): the parcel is boxed and waits for the courier. Nothing leaves the shelf yet.
const mark_order_packed = async (request, res) => {
    const { oid } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const invoice_no = await execute_transaction(async (tx) => {
            const packed = await tx.execute_value({
                text: `UPDATE ${TABLE.ONLINE_ORDER} oo SET delivery_status = 'Packed', packed_on = clock_timestamp(), edited_by = $1, edited_on = clock_timestamp()
                         FROM ${TABLE.ORDERS} o
                        WHERE oo.order_oid = $2 AND o.oid = oo.order_oid AND o.status = 'Confirmed' AND o.dispatched_on IS NULL AND oo.delivery_status = 'Preparing'
                    RETURNING o.invoice_no`,
                values: [user_id, oid],
            });
            if (packed.rowCount !== 1) await refuse_change(tx, oid, "marked packed");
            await recordStatusHistory(tx, { order_oid: oid, kind: "Delivery", from_status: "Preparing", to_status: "Packed", user_id });
            await saveLogActivity({ reference_type: "order", reference_oid: oid, title: "Online order packed", description: packed.rows[0].invoice_no }, { tx, request });
            return packed.rows[0].invoice_no;
        });
        log.info(`Online order ${invoice_no} packed by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Marked packed", data: { oid, invoice_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while marking an order packed: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The order was not marked packed. Try again in a moment." });
    }
};

module.exports = mark_order_packed;
