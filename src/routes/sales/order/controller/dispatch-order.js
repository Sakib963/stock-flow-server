const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { deductHeldStock } = require("../../utils/stock-movement");
const { recordStatusHistory } = require("../../utils/order-utils");
const { refuse_change } = require("../utils/order-state");

// Dispatch (sales REQ-54): the parcel leaves with the courier, so the held units leave the shelf now,
// each batch through the stock helpers with a "dispatched" movement. The order stays Confirmed
// (REQ-112); after this it can no longer be cancelled, only returned.
const dispatch_order = async (request, res) => {
    const { oid, courier, consignment_no } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const invoice_no = await execute_transaction(async (tx) => {
            const dispatched = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS} o SET dispatched_on = clock_timestamp(), edited_by = $1, edited_on = clock_timestamp()
                         FROM ${TABLE.ONLINE_ORDER} oo
                        WHERE o.oid = $2 AND oo.order_oid = o.oid AND o.channel = 'ONLINE' AND o.status = 'Confirmed' AND o.dispatched_on IS NULL AND oo.delivery_status IN ('Preparing', 'Packed')
                    RETURNING o.invoice_no, oo.delivery_status`,
                values: [user_id, oid],
            });
            if (dispatched.rowCount !== 1) await refuse_change(tx, oid, "dispatched");
            const { invoice_no, delivery_status } = dispatched.rows[0];
            const deducted = await deductHeldStock(tx, { order_oid: oid, user_id });
            if (!deducted.ok) fail(409, `The stock held for ${invoice_no} is no longer on the shelf. Nothing was dispatched; check the batch with a stock count.`);
            await tx.execute_value({
                text: `UPDATE ${TABLE.ONLINE_ORDER} SET delivery_status = 'WithCourier', courier = $1, consignment_no = $2, edited_by = $3, edited_on = clock_timestamp() WHERE order_oid = $4`,
                values: [courier, consignment_no, user_id, oid],
            });
            await recordStatusHistory(tx, { order_oid: oid, kind: "Delivery", from_status: delivery_status, to_status: "WithCourier", reason: consignment_no ? `${courier} ${consignment_no}` : courier, user_id });
            await saveLogActivity({ reference_type: "order", reference_oid: oid, title: "Online order dispatched", description: `${invoice_no}, ${courier}${consignment_no ? ` ${consignment_no}` : ""}` }, { tx, request });
            return invoice_no;
        });
        log.info(`Online order ${invoice_no} dispatched by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Dispatched", data: { oid, invoice_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while dispatching an order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The order was not dispatched. Try again in a moment." });
    }
};

module.exports = dispatch_order;
