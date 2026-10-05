const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { recordStatusHistory } = require("../../utils/order-utils");
const { learn_area } = require("../../location/utils/learn-area");
const { invalidate_location_index } = require("../../location/utils/location-index");
const { refuse_change, refuse_unless_own } = require("../utils/order-state");

// Confirm (sales REQ-50): the business checked the order is real, and says how. It moves no stock:
// the units were held when the order was placed. The confirmed area is learned under its thana, so
// the order helper ranks that place first next time (REQ-83).
const confirm_order = async (request, res) => {
    const { oid, confirmed_via, note } = request.body;
    const user_id = request.credentials.user_id;
    try {
        const { invoice_no, learned } = await execute_transaction(async (tx) => {
            await refuse_unless_own(tx, oid, request);
            const confirmed = await tx.execute_value({
                text: `UPDATE ${TABLE.ORDERS} SET status = 'Confirmed', edited_by = $1, edited_on = clock_timestamp()
                        WHERE oid = $2 AND channel = 'ONLINE' AND status = 'Pending' RETURNING invoice_no`,
                values: [user_id, oid],
            });
            if (confirmed.rowCount !== 1) await refuse_change(tx, oid, "confirmed");
            const [online] = await tx.get_data({
                text: `UPDATE ${TABLE.ONLINE_ORDER} SET confirmed_via = $1, confirmed_note = $2, confirmed_on = clock_timestamp(), confirmed_by = $3, delivery_status = 'Preparing', edited_by = $3, edited_on = clock_timestamp()
                        WHERE order_oid = $4 RETURNING thana_oid, area_text`,
                values: [confirmed_via, note, user_id, oid],
            });
            let area_oid = null;
            if (online?.thana_oid && online.area_text) {
                area_oid = await learn_area(tx, { thana_oid: online.thana_oid, name: online.area_text, user_id });
                if (area_oid) await tx.execute_value({ text: `UPDATE ${TABLE.ONLINE_ORDER} SET area_oid = $1 WHERE order_oid = $2`, values: [area_oid, oid] });
            }
            await recordStatusHistory(tx, { order_oid: oid, from_status: "Pending", to_status: "Confirmed", reason: note ? `${confirmed_via}: ${note}` : confirmed_via, user_id });
            await recordStatusHistory(tx, { order_oid: oid, kind: "Delivery", from_status: null, to_status: "Preparing", reason: null, user_id });
            const { invoice_no } = confirmed.rows[0];
            await saveLogActivity({ reference_type: "order", reference_oid: oid, title: "Online order confirmed", description: `${invoice_no}, ${confirmed_via}` }, { tx, request });
            return { invoice_no, learned: !!area_oid };
        });
        if (learned) invalidate_location_index();
        log.info(`Online order ${invoice_no} confirmed by ${user_id}`);
        return res.status(200).json({ code: 200, message: "Order confirmed", data: { oid, invoice_no } });
    } catch (e) {
        if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
        log.error(`An exception occurred while confirming an order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "The order was not confirmed. Try again in a moment." });
    }
};

module.exports = confirm_order;
