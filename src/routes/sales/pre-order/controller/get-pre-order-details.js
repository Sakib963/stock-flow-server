const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { VERSION } = require("../../../../db/stale-edit");
const { log } = require("../../../../utils/log");
const { sees_money } = require("../../../inventory/utils/sees-money");
const { SELLABLE_BY_PRODUCT_CTE, priceHints } = require("../utils/pre-order-utils");

const HINTS = priceHints("poi.product_oid");

// Never cached: each line's sellable now is live stock.
const get_pre_order_details = async (request, res) => {
    try {
        const oid = request.params.oid;
        const [details] = await get_data({
            text: `SELECT po.oid, po.preorder_no, po.customer_oid, c.name AS customer_name, c.phone AS customer_phone, po.status, po.total_amount::int AS total_amount,
                          po.advance_paid::int AS advance_paid, po.advance_method, po.advance_reference, po.advance_refund_due::int AS advance_refund_due, po.advance_refunded::int AS advance_refunded,
                          po.refunded_on, to_char(po.expected_date, 'YYYY-MM-DD') AS expected_date, po.notes, po.cancel_reason, po.converted_order_oid, o.invoice_no AS converted_invoice_no,
                          po.created_on, COALESCE(u.name, po.created_by) AS created_by, po.${VERSION}
                     FROM ${TABLE.PRE_ORDERS} po
                     JOIN ${TABLE.CUSTOMERS} c ON c.oid = po.customer_oid
                     LEFT JOIN ${TABLE.ORDERS} o ON o.oid = po.converted_order_oid
                     LEFT JOIN ${TABLE.LOGIN} u ON u.email = po.created_by
                    WHERE po.oid = $1`,
            values: [oid],
        });
        if (!details) return res.status(404).json({ code: 404, message: "No pre-order with that number." });

        const [lines, cancelled, activity] = await Promise.all([
            get_data({
                text: `SELECT poi.oid, poi.product_oid, p.name AS product_name, p.sku, poi.quantity::int AS quantity, poi.unit_price::int AS unit_price, poi.total::int AS total, COALESCE(s.sellable, 0) AS sellable, ${HINTS.select}
                         FROM ${TABLE.PRE_ORDER_ITEMS} poi
                         JOIN ${TABLE.PRODUCT} p ON p.oid = poi.product_oid
                         LEFT JOIN (${SELLABLE_BY_PRODUCT_CTE}) s ON s.product_oid = poi.product_oid
                         ${HINTS.joins}
                        WHERE poi.pre_order_oid = $1 ORDER BY p.name`,
                values: [oid],
            }),
            get_data({ text: `SELECT reason FROM ${TABLE.PRE_ORDER_STATUS_HISTORY} WHERE pre_order_oid = $1 AND to_status = 'Cancelled' ORDER BY performed_on DESC LIMIT 1`, values: [oid] }),
            get_data({
                text: `SELECT a.title, a.description, COALESCE(u.name, a.performed_by) AS performed_by, a.performed_on
                         FROM ${TABLE.ACTIVITY_LOG} a LEFT JOIN ${TABLE.LOGIN} u ON u.email = a.performed_by
                        WHERE a.reference_type = 'pre_order' AND a.reference_oid = $1 ORDER BY a.performed_on DESC`,
                values: [oid],
            }),
        ]);
        if (!(await sees_money(request))) for (const line of lines) delete line.last_cost;
        const cancel_note = cancelled[0] && cancelled[0].reason !== details.cancel_reason ? cancelled[0].reason : null;
        return res.status(200).json({ code: 200, message: "Pre-order", data: { ...details, cancel_note, lines, activity } });
    } catch (e) {
        log.error(`An exception occurred while reading a pre-order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the pre-order. Try again in a moment." });
    }
};

module.exports = get_pre_order_details;
