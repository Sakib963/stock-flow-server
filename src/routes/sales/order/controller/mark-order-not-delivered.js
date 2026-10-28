const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { recordStatusHistory } = require("../../utils/order-utils");
const { refuse_change } = require("../utils/order-state");
const { raiseReturn } = require("../../return/utils/return-utils");

// Not delivered (sales REQ-56, REQ-111): the courier reports the parcel could not be handed over, so
// its delivery status is Failed with the reason, and a Pending return of everything on it is raised
// at once (decided by the user, 2026-10-10). It is never a sale. The units come back onto the shelf
// when the parcel is in the shop and that return is confirmed; the delivery charge is kept.
const mark_order_not_delivered = async (request, res) => {
    const { oid, reason, note } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const { invoice_no, return_oid, return_no } = await execute_transaction(async (tx) => {
            // The order row is locked before the parcel row, the order Deliver takes them in; the other
            // way round, pressing both at once deadlocked and one of them answered 500 instead of 409.
            const [order] = await tx.get_data({
                text: `SELECT oid, invoice_no, payment_status, delivery_charge::int AS delivery_charge, total_amount::int AS total_amount, amount_paid::int AS amount_paid,
                              amount_refunded::int AS amount_refunded, refund_due::int AS refund_due
                         FROM ${TABLE.ORDERS} WHERE oid = $1 FOR UPDATE`,
                values: [oid],
            });
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
            const parcel = await raiseReturn(tx, request, { oid: uuidv4(), order, items: [], return_reason: "not_delivered", not_delivered_reason: reason, note });
            return { invoice_no, return_oid: parcel.return_oid, return_no: parcel.return_no };
        });
        log.info(`Online order ${invoice_no} recorded as not delivered by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Recorded as not delivered", data: { oid, invoice_no, return_oid, return_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while recording an order not delivered: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "It was not recorded. Try again in a moment." });
    }
};

module.exports = mark_order_not_delivered;
