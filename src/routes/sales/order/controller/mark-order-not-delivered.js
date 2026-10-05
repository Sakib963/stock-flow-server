const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { recordStatusHistory } = require("../../utils/order-utils");
const { refuse_change } = require("../utils/order-state");

// Not delivered (sales REQ-56, REQ-111): the courier reports the parcel could not be handed over, so
// its delivery status is Failed with the reason. It is never a sale. The units come back onto the
// shelf only when the parcel is in the shop and its return is confirmed, which arrives with returns.
const mark_order_not_delivered = async (request, res) => {
    const { oid, reason, note } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const invoice_no = await execute_transaction(async (tx) => {
            const failed = await tx.execute_value({
                text: `UPDATE ${TABLE.ONLINE_ORDER} oo SET delivery_status = 'Failed', edited_by = $1, edited_on = clock_timestamp()
                         FROM ${TABLE.ORDERS} o
                        WHERE oo.order_oid = $2 AND o.oid = oo.order_oid AND o.status = 'Confirmed' AND oo.delivery_status = 'WithCourier'
                    RETURNING o.invoice_no`,
                values: [user_id, oid],
            });
            if (failed.rowCount !== 1) await refuse_change(tx, oid, "recorded as not delivered");
            const { invoice_no } = failed.rows[0];
            await recordStatusHistory(tx, { order_oid: oid, kind: "Delivery", from_status: "WithCourier", to_status: "Failed", reason: note ? `${reason}: ${note}` : reason, user_id });
            await saveLogActivity({ reference_type: "order", reference_oid: oid, title: "Online order not delivered", description: `${invoice_no}, ${reason}` }, { tx, request });
            return invoice_no;
        });
        log.info(`Online order ${invoice_no} recorded as not delivered by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Recorded as not delivered", data: { oid, invoice_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while recording an order not delivered: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "It was not recorded. Try again in a moment." });
    }
};

module.exports = mark_order_not_delivered;
