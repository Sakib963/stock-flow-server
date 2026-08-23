const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

// Pre-order demand for one product (FR-37).
//
// This is the reorder signal: "14 units pre-ordered across 6 bookings" tells the
// owner what to buy. It powers the product detail page panel and doubles as the
// waiting list to work through when a shipment lands.
const get_pre_orders_by_product = async (request, res) => {
    try {
        const product_oid = request.query.product_oid;

        const data = await get_data({
            text: `
                SELECT po.oid,
                       po.preorder_no,
                       po.customer_name,
                       po.customer_phone,
                       po.status,
                       po.expected_date,
                       po.created_on,
                       CAST(poi.quantity AS INTEGER) AS quantity,
                       poi.oid AS pre_order_item_oid
                  FROM ${TABLE.PRE_ORDERS} po
                  JOIN ${TABLE.PRE_ORDER_ITEMS} poi ON poi.pre_order_oid = po.oid
                 WHERE poi.product_oid = $1
                   AND po.status IN ('Pending', 'Confirmed')
                 ORDER BY po.created_on ASC
            `,
            values: [product_oid],
        });

        const totalUnits = data.reduce((sum, row) => sum + Number(row.quantity), 0);

        log.info(`Pre-order demand for product ${product_oid}: ${totalUnits} unit(s) across ${data.length} booking(s)`);
        return res.status(200).json({
            code: 200,
            message: "Pre-order demand found",
            total: data.length,
            data: { totalUnits, bookingCount: data.length, preOrders: data },
        });
    } catch (e) {
        log.error(`An exception occurred while getting pre-order demand: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_pre_orders_by_product;
