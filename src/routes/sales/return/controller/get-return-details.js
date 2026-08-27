const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

// One return, everything the detail page needs: the header, the order it came
// from, and the lines with their batch, condition and what happened to them.
const get_return_details = async (request, res) => {
    try {
        const return_oid = request.params.oid;

        const headers = await get_data({
            text: `SELECT pr.oid,
                          pr.invoice_no AS return_no,
                          pr.order_oid,
                          CAST(pr.refund_amount AS INTEGER) AS refund_amount,
                          pr.refund_delivery_charge,
                          pr.return_reason,
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
                          -- Derived the same way as create-return: payment_status is
                          -- authoritative because amount_paid is not written by every
                          -- intake path.
                          CASE
                                WHEN o.payment_status = 'paid' THEN CAST(o.total_amount AS INTEGER)
                                WHEN o.payment_status = 'partially_paid' THEN CAST(COALESCE(o.amount_paid, 0) AS INTEGER)
                                ELSE 0
                          END AS order_amount_paid,
                          o.payment_status,
                          o.customer_name,
                          o.customer_phone,
                          o.customer_address
                     FROM ${TABLE.PRODUCT_RETURN} pr
                     JOIN ${TABLE.ORDERS} o ON o.oid = pr.order_oid
                     LEFT JOIN ${TABLE.LOGIN} cl ON cl.email = pr.created_by
                     LEFT JOIN ${TABLE.LOGIN} el ON el.email = pr.edited_by
                    WHERE pr.oid = $1`,
            values: [return_oid],
        });

        if (!headers.length) {
            log.info(`No return found for oid: ${return_oid}`);
            return res.status(404).json({ code: 404, message: "Return not found" });
        }

        // Line refund mirrors what the customer actually paid for the unit:
        // unit_price minus the per-unit discount that was applied at sale time.
        //
        // order_items is LEFT joined on purpose: returns written by the old
        // salesman controller have no order_item_oid, and an inner join would
        // render those historical returns as empty. They lose the price columns,
        // not the products.
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
                     LEFT JOIN ${TABLE.ORDER_ITEMS} oi ON oi.oid = rd.order_item_oid
                     LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = rd.product_oid
                     LEFT JOIN ${TABLE.INVENTORY} inv ON inv.oid = rd.inventory_oid
                    WHERE rd.return_oid = $1
                    ORDER BY product_name`,
            values: [return_oid],
        });

        const header = headers[0];

        // Three figures, not one. The goods are worth what the customer was
        // charged (return_value); refund_amount is the part the shop actually
        // received and therefore owes back; the difference simply cancels part of
        // what the customer still owes. On a fully paid order the first two match.
        const return_value = items.reduce((s, i) => s + Number(i.line_refund || 0), 0) + (header.refund_delivery_charge ? Number(header.delivery_charge || 0) : 0);

        const data = {
            ...header,
            items,
            return_value,
            due_reduction: Math.max(0, return_value - Number(header.refund_amount || 0)),
            total_units: items.reduce((s, i) => s + Number(i.return_quantity), 0),
            restocked_units: items.filter((i) => i.action === "Restocked").reduce((s, i) => s + Number(i.return_quantity), 0),
            disposed_units: items.filter((i) => i.action === "Disposed").reduce((s, i) => s + Number(i.return_quantity), 0),
            // One disposal document is created per return, so any damaged line
            // points at the same one.
            dispose_oid: items.find((i) => i.dispose_oid)?.dispose_oid || null,
        };

        log.info(`Return details found for oid: ${return_oid}`);
        return res.status(200).json({ code: 200, message: "Return details found", data });
    } catch (e) {
        log.error(`An exception occurred while getting return details: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_return_details;
