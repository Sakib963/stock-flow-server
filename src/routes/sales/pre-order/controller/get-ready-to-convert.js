const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { SELLABLE_BY_PRODUCT_CTE } = require("../../../../utils/pre-order-utils");
const { log } = require("../../../../utils/log");

// Ready-to-convert queue (FR-39): open bookings where EVERY line is now
// fulfillable, oldest first. This is what to work through when a shipment lands.
//
// BOOL_AND enforces the all-or-nothing rule (D4) directly in SQL: one short line
// and the whole booking drops out of the queue.
const get_ready_to_convert = async (request, res) => {
    try {
        const data = await get_data({
            text: `
                WITH sellable AS (${SELLABLE_BY_PRODUCT_CTE}),
                readiness AS (
                    SELECT po.oid,
                           BOOL_AND(COALESCE(s.sellable_quantity, 0) >= poi.quantity) AS is_ready
                      FROM ${TABLE.PRE_ORDERS} po
                      JOIN ${TABLE.PRE_ORDER_ITEMS} poi ON poi.pre_order_oid = po.oid
                      LEFT JOIN sellable s ON s.product_oid = poi.product_oid
                     WHERE po.status IN ('Pending', 'Confirmed')
                     GROUP BY po.oid
                )
                SELECT po.oid,
                       po.preorder_no,
                       po.customer_name,
                       po.customer_phone,
                       po.status,
                       po.expected_date,
                       po.created_on,
                       CAST(po.total_amount AS INTEGER) AS total_amount,
                       CAST(po.advance_paid AS INTEGER) AS advance_paid,
                       COUNT(poi.oid) AS item_count
                  FROM readiness r
                  JOIN ${TABLE.PRE_ORDERS} po ON po.oid = r.oid
                  LEFT JOIN ${TABLE.PRE_ORDER_ITEMS} poi ON poi.pre_order_oid = po.oid
                 WHERE r.is_ready
                 GROUP BY po.oid
                 ORDER BY po.created_on ASC
            `,
            values: [],
        });

        log.info(`Pre-orders ready to convert: ${data.length}`);
        return res.status(200).json({ code: 200, message: "Ready-to-convert pre-orders found", total: data.length, data });
    } catch (e) {
        log.error(`An exception occurred while getting ready-to-convert pre-orders: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_ready_to_convert;
