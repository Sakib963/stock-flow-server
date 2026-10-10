const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");
const { sees_addresses } = require("../../customer/utils/address");

// One return, everything the detail page needs: the header, the order it came
// from, and the lines with their batch, condition and what happened to them.
const get_return_details = async (request, res) => {
    try {
        const return_oid = request.params.oid;
        const channels = await channels_of(request);

        const headers = await get_data({
            text: `SELECT pr.oid,
                          pr.invoice_no AS return_no,
                          pr.order_oid,
                          CAST(pr.refund_amount AS INTEGER) AS refund_amount,
                          pr.refund_delivery_charge,
                          pr.return_reason,
                          pr.not_delivered_reason,
                          pr.notes,
                          pr.status,
                          pr.created_on,
                          COALESCE(cl.name, pr.created_by) AS created_by,
                          pr.edited_on,
                          COALESCE(el.name, pr.edited_by) AS edited_by,
                          o.invoice_no,
                          o.channel,
                          o.status AS order_status,
                          o.created_on AS order_date,
                          CAST(o.total_amount AS INTEGER) AS order_total,
                          CAST(o.delivery_charge AS INTEGER) AS delivery_charge,
                          o.amount_paid::int AS order_amount_paid,
                          o.amount_refunded::int AS order_amount_refunded,
                          o.refund_due::int AS order_refund_due,
                          o.refund_status AS order_refund_status,
                          oo.delivery_status,
                          o.payment_status,
                          o.customer_name,
                          o.customer_phone,
                          o.customer_address
                     FROM ${TABLE.PRODUCT_RETURN} pr
                     JOIN ${TABLE.ORDERS} o ON o.oid = pr.order_oid
                     LEFT JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
                     LEFT JOIN ${TABLE.LOGIN} cl ON cl.email = pr.created_by
                     LEFT JOIN ${TABLE.LOGIN} el ON el.email = pr.edited_by
                    WHERE pr.oid = $1 AND o.channel = ANY($2)`,
            values: [return_oid, channels],
        });

        if (!headers.length) {
            log.info(`No return found for oid: ${return_oid}`);
            return res.status(404).json({ code: 404, message: "No return with that number." });
        }

        const items = await get_data({
            text: `SELECT rd.oid,
                          rd.order_item_oid,
                          rd.product_oid,
                          rd.inventory_oid,
                          rd.condition,
                          rd.action,
                          rd.dispose_oid,
                          CAST(rd.return_quantity AS INTEGER) AS return_quantity,
                          COALESCE(p.name, oi.product_name) AS product_name,
                          inv.batch_code,
                          CAST(oi.quantity AS INTEGER) AS sold_quantity,
                          CAST(oi.unit_price AS INTEGER) AS unit_price,
                          CAST(COALESCE(oi.discount, 0) AS INTEGER) AS discount,
                          (rd.return_quantity * GREATEST(COALESCE(oi.unit_price, 0) - COALESCE(oi.discount, 0), 0))::int AS line_refund
                     FROM ${TABLE.RETURN_DETAILS} rd
                     JOIN ${TABLE.ORDER_ITEMS} oi ON oi.oid = rd.order_item_oid
                     LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = rd.product_oid
                     LEFT JOIN ${TABLE.INVENTORY} inv ON inv.oid = rd.inventory_oid
                    WHERE rd.return_oid = $1
                    ORDER BY product_name`,
            values: [return_oid],
        });

        // Only returns of orders in the person's channels, and no address for someone who sells only at the counter.
        const { customer_address, ...rest } = headers[0];
        const header = sees_addresses(channels) ? headers[0] : rest;

        // What the goods were worth; the refund is the part of it that was paid, the rest only lowers what is owed.
        const return_value = items.reduce((s, i) => s + Number(i.line_refund || 0), 0) + (header.refund_delivery_charge ? Number(header.delivery_charge || 0) : 0);

        const data = {
            ...header,
            items,
            return_value,
            due_reduction: Math.max(0, return_value - Number(header.refund_amount || 0)),
            total_units: items.reduce((s, i) => s + Number(i.return_quantity), 0),
            restocked_units: items.filter((i) => i.action === "Restocked").reduce((s, i) => s + Number(i.return_quantity), 0),
            disposed_units: items.filter((i) => i.action === "Disposed").reduce((s, i) => s + Number(i.return_quantity), 0),
            dispose_oid: items.find((i) => i.dispose_oid)?.dispose_oid || null,
        };

        log.info(`Return details found for oid: ${return_oid}`);
        return res.status(200).json({ code: 200, message: "Return details found", data });
    } catch (e) {
        log.error(`An exception occurred while getting return details: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load this return. Try again in a moment." });
    }
};

module.exports = get_return_details;
