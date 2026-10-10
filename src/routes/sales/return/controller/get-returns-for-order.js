const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");

// The returns of one order, for its record page, with what each line can still take back.
const get_returns_for_order = async (request, res) => {
    try {
        const { order_oid } = request.query;
        const channels = await channels_of(request);
        const returns = await get_data({
            text: `SELECT pr.oid, pr.invoice_no AS return_no, pr.refund_amount::int AS refund_amount, pr.return_reason, pr.not_delivered_reason, pr.status, pr.created_on,
                          COALESCE(l.name, pr.created_by) AS created_by_name,
                          (SELECT COALESCE(SUM(rd.return_quantity), 0)::int FROM ${TABLE.RETURN_DETAILS} rd WHERE rd.return_oid = pr.oid) AS units
                     FROM ${TABLE.PRODUCT_RETURN} pr
                     JOIN ${TABLE.ORDERS} o ON o.oid = pr.order_oid AND o.channel = ANY($2)
                     LEFT JOIN ${TABLE.LOGIN} l ON l.email = pr.created_by
                    WHERE pr.order_oid = $1
                    ORDER BY pr.created_on DESC`,
            values: [order_oid, channels],
        });
        const returnable = await get_data({
            text: `SELECT oi.oid AS order_item_oid,
                          (oi.quantity - oi.returned_qty - COALESCE((SELECT SUM(rd.return_quantity) FROM ${TABLE.RETURN_DETAILS} rd JOIN ${TABLE.PRODUCT_RETURN} pr ON pr.oid = rd.return_oid
                                                                     WHERE rd.order_item_oid = oi.oid AND pr.status = 'Pending'), 0))::int AS returnable
                     FROM ${TABLE.ORDER_ITEMS} oi JOIN ${TABLE.ORDERS} o ON o.oid = oi.order_oid AND o.channel = ANY($2)
                    WHERE oi.order_oid = $1`,
            values: [order_oid, channels],
        });
        return res.status(200).json({ code: 200, message: "Returns of the order", data: { returns, returnable } });
    } catch (e) {
        log.error(`An exception occurred while reading the returns of an order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the returns of this order. Try again in a moment." });
    }
};

module.exports = get_returns_for_order;
