const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");
const { RETURNABLE_ORDER_STATUS, raiseReturn } = require("../utils/return-utils");

// Raises a Pending return against a sale. The oid is made by the client, so a request repeated after
// a lost answer finds the return it already raised instead of raising a second one.
const create_return = async (request, res) => {
    const { oid, order_oid, items, return_reason, refund_delivery_charge = false, note } = request.body;
    try {
        const channels = await channels_of(request);
        const outcome = await execute_transaction(async (tx) => {
            const [order] = await tx.get_data({
                text: `SELECT oid, invoice_no, status, channel, payment_status, delivery_charge::int AS delivery_charge, total_amount::int AS total_amount,
                              amount_paid::int AS amount_paid, amount_refunded::int AS amount_refunded, refund_due::int AS refund_due
                         FROM ${TABLE.ORDERS} WHERE oid = $1 AND channel = ANY($2) FOR UPDATE`,
                values: [order_oid, channels],
            });
            if (!order) fail(404, "No order with that number.");

            const [already] = await tx.get_data({ text: `SELECT oid AS return_oid, invoice_no AS return_no, refund_amount::int AS refund_amount, order_oid FROM ${TABLE.PRODUCT_RETURN} WHERE oid = $1`, values: [oid] });
            if (already) {
                if (already.order_oid !== order_oid) fail(409, "That return number belongs to another order.");
                return { ...already, repeated: true };
            }
            if (!RETURNABLE_ORDER_STATUS.includes(order.status)) fail(409, `${order.invoice_no} is ${order.status}. Only a sale can be returned.`);

            return raiseReturn(tx, request, { oid, order, items, return_reason, refund_delivery_charge, note });
        });
        if (!outcome.repeated) log.info(`Return ${outcome.return_no} raised by ${request.credentials.user_id}`);
        return res.status(200).json({ code: 200, message: "Return recorded. Confirm it when the goods are back to restock them.", data: outcome });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while raising a return: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The return was not recorded. Try again in a moment." });
    }
};

module.exports = create_return;
