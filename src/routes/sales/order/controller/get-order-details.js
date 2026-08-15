const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

// Full order for the detail page: header + line items + status-history timeline.
const get_order_details = async (request, res) => {
    try {
        const oid = request.query.oid || request.params.oid;
        const header = await get_data({
            text: `SELECT o.oid, o.invoice_no, o.channel, o.order_type, o.status,
                          o.customer_oid, o.customer_name, o.customer_phone, o.customer_address, o.customer_email,
                          o.delivery_city, o.delivery_zone, o.delivery_area, o.delivery_postcode,
                          CAST(o.subtotal AS INTEGER) AS subtotal,
                          CAST(o.discount_total AS INTEGER) AS discount_total,
                          CAST(o.delivery_charge AS INTEGER) AS delivery_charge,
                          CAST(o.total_amount AS INTEGER) AS total_amount,
                          CAST(o.amount_paid AS INTEGER) AS amount_paid,
                          o.payment_type, o.payment_method, o.payment_reference, o.payment_status,
                          o.dispatched_on, o.delivered_on, o.cancelled_on, o.cancel_reason,
                          o.notes, o.created_by, o.created_on, o.edited_by, o.edited_on
                     FROM ${TABLE.ORDERS} o WHERE o.oid = $1`,
            values: [oid],
        });
        if (!header.length) return res.status(404).json({ code: 404, message: "Order not found" });

        const [items, history] = await Promise.all([
            get_data({
                text: `SELECT oi.oid, oi.inventory_oid, oi.product_oid, oi.product_name,
                              CAST(oi.available_stock AS INTEGER) AS quantity_available,
                              CAST(oi.quantity AS INTEGER) AS quantity,
                              CAST(oi.returned_qty AS INTEGER) AS returned_qty,
                              CAST(oi.unit_price AS NUMERIC) AS unit_price,
                              CAST(oi.discount AS NUMERIC) AS discount,
                              CAST(oi.total AS NUMERIC) AS total
                         FROM ${TABLE.ORDER_ITEMS} oi WHERE oi.order_oid = $1 ORDER BY oi.product_name`,
                values: [oid],
            }),
            get_data({
                text: `SELECT from_status, to_status, reason, performed_by,
                              TO_CHAR(performed_on, 'YYYY-MM-DD"T"HH24:MI:SS') AS performed_on
                         FROM ${TABLE.ORDER_STATUS_HISTORY} WHERE order_oid = $1 ORDER BY performed_on ASC`,
                values: [oid],
            }),
        ]);

        const data = { ...header[0], items, status_history: history };
        log.info(`Order details found for ${oid}`);
        return res.status(200).json({ code: 200, message: "Order details found", data });
    } catch (e) {
        log.error(`An exception occurred while getting order details: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_order_details;
