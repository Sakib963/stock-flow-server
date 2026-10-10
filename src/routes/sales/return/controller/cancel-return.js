const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { recordStatusHistory } = require("../../utils/order-utils");
const { channels_of } = require("../../utils/channels");
const { log } = require("../../../../utils/log");

// Only a Pending return can be cancelled: nothing has moved yet. A Not delivered recorded by mistake
// is undone here too, so the parcel is with the courier again and can still be delivered.
const cancel_return = async (request, res) => {
    const { oid: return_oid, reason } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const channels = await channels_of(request);
        const outcome = await execute_transaction(async (tx) => {
            const cancelled = await tx.execute_value({
                text: `UPDATE ${TABLE.PRODUCT_RETURN} pr
                          SET status = 'Cancelled', notes = LEFT(COALESCE(pr.notes || ' | ', '') || 'Cancelled: ' || $1, 256), edited_by = $2, edited_on = clock_timestamp()
                         FROM ${TABLE.ORDERS} o
                        WHERE pr.oid = $3 AND pr.status = 'Pending' AND o.oid = pr.order_oid AND o.channel = ANY($4)
                    RETURNING pr.order_oid, pr.invoice_no AS return_no, pr.return_reason`,
                values: [reason, user_id, return_oid, channels],
            });
            if (cancelled.rowCount !== 1) {
                const [row] = await tx.get_data({ text: `SELECT pr.status, pr.invoice_no FROM ${TABLE.PRODUCT_RETURN} pr JOIN ${TABLE.ORDERS} o ON o.oid = pr.order_oid WHERE pr.oid = $1 AND o.channel = ANY($2)`, values: [return_oid, channels] });
                if (!row) fail(404, "No return with that number.");
                fail(409, `${row.invoice_no} is already ${row.status === "Returned" ? "confirmed, so its stock has moved" : "cancelled"}. Reload it to see what changed.`, { status: row.status });
            }
            const ret = cancelled.rows[0];
            if (ret.return_reason === "not_delivered") {
                const back = await tx.execute_value({ text: `UPDATE ${TABLE.ONLINE_ORDER} SET delivery_status = 'WithCourier', edited_by = $1, edited_on = clock_timestamp() WHERE order_oid = $2 AND delivery_status = 'Failed'`, values: [user_id, ret.order_oid] });
                if (back.rowCount === 1) await recordStatusHistory(tx, { order_oid: ret.order_oid, kind: "Delivery", from_status: "Failed", to_status: "WithCourier", reason: ret.return_no, user_id });
            }
            await saveLogActivity({ reference_type: "order", reference_oid: ret.order_oid, title: "Return cancelled", description: `${ret.return_no} cancelled before it was confirmed: ${reason}` }, { tx, request });
            return ret;
        });
        log.info(`Return ${outcome.return_no} cancelled by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Return cancelled", data: { oid: return_oid, return_no: outcome.return_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while cancelling a return: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The return was not cancelled. Try again in a moment." });
    }
};

module.exports = cancel_return;
