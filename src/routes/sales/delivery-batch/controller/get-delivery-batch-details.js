const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { ORDER_COLUMNS, ORDER_FROM } = require("../utils/batch-orders");

const get_delivery_batch_details = async (request, res) => {
    const { oid } = request.params;
    try {
        const [batch] = await get_data({
            text: `SELECT b.oid, b.batch_no, b.courier, b.status, b.note, b.cancel_note, b.created_on, COALESCE(c.name, b.created_by) AS created_by,
                          b.handed_over_on, COALESCE(h.name, b.handed_over_by) AS handed_over_by, b.cancelled_on
                     FROM ${TABLE.DELIVERY_BATCH} b
                     LEFT JOIN ${TABLE.LOGIN} c ON c.email = b.created_by
                     LEFT JOIN ${TABLE.LOGIN} h ON h.email = b.handed_over_by
                    WHERE b.oid = $1`,
            values: [oid],
        });
        if (!batch) return res.status(404).json({ code: 404, message: "No delivery batch with that number." });
        // A cancelled batch keeps the orders it had, so its record still says what was in it.
        const [orders, activity] = await Promise.all([
            get_data({
                text: `SELECT ${ORDER_COLUMNS} FROM ${TABLE.DELIVERY_BATCH_ORDER} bo JOIN ${ORDER_FROM} ON o.oid = bo.order_oid
                        WHERE bo.batch_oid = $1 AND (bo.active OR $2) ORDER BY o.created_on, o.oid`,
                values: [oid, batch.status === "Cancelled"],
            }),
            get_data({
                text: `SELECT a.title, a.description, COALESCE(u.name, a.performed_by) AS performed_by, a.performed_on
                         FROM ${TABLE.ACTIVITY_LOG} a LEFT JOIN ${TABLE.LOGIN} u ON u.email = a.performed_by
                        WHERE a.reference_type = 'delivery-batch' AND a.reference_oid = $1 ORDER BY a.performed_on DESC`,
                values: [oid],
            }),
        ]);
        return res.status(200).json({ code: 200, message: "Delivery batch", data: { ...batch, orders, activity } });
    } catch (e) {
        log.error(`An exception occurred while loading delivery batch ${oid}: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the delivery batch. Try again in a moment." });
    }
};

module.exports = get_delivery_batch_details;
