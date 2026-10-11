const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// What the online order page needs to make an order from a booking (REQ-07): the customer, the advance
// and each booked line with the batches of its product an order can take, in the counter's batch shape.
// The page never guesses a batch: the moderator picks one per line.
const get_pre_order_for_conversion = async (request, res) => {
    try {
        const oid = request.params.oid;
        const [booking] = await get_data({
            text: `SELECT po.oid, po.preorder_no, po.status, c.phone_normalized AS customer_phone, c.name AS customer_name, (po.advance_paid - po.advance_refunded)::int AS advance,
                          po.advance_method, po.advance_reference, po.notes
                     FROM ${TABLE.PRE_ORDERS} po JOIN ${TABLE.CUSTOMERS} c ON c.oid = po.customer_oid
                    WHERE po.oid = $1`,
            values: [oid],
        });
        if (!booking) return res.status(404).json({ code: 404, message: "No pre-order with that number." });
        if (!["Pending", "Confirmed"].includes(booking.status)) return res.status(409).json({ code: 409, message: `${booking.preorder_no} is already ${booking.status === "Converted" ? "an order" : "cancelled"}.`, data: { status: booking.status } });

        const lines = await get_data({
            text: `SELECT poi.oid, poi.product_oid, p.name AS product_name, p.sku, poi.quantity::int AS quantity, poi.unit_price::int AS unit_price,
                          COALESCE(json_agg(json_build_object(
                              'product_oid', i.product_oid, 'product_name', p.name, 'image_url', p.photo, 'sku', p.sku, 'inventory_oid', i.oid, 'batch_code', i.batch_code,
                              'expiry_date', to_char(i.expiry_date, 'YYYY-MM-DD'), 'quantity_available', i.quantity_available::int, 'sellable_quantity', (i.quantity_available - h.held)::int,
                              'selling_price', i.selling_price::int, 'maximum_discount', COALESCE(i.maximum_discount, 0)::int) ORDER BY i.created_on) FILTER (WHERE i.quantity_available > h.held), '[]') AS batches
                     FROM ${TABLE.PRE_ORDER_ITEMS} poi
                     JOIN ${TABLE.PRODUCT} p ON p.oid = poi.product_oid
                     LEFT JOIN ${TABLE.INVENTORY} i ON i.product_oid = poi.product_oid AND i.intended_use = 'for_sale' AND i.status = 'ready_for_sale' AND i.selling_price IS NOT NULL
                     LEFT JOIN LATERAL (SELECT COALESCE(SUM(quantity), 0) AS held FROM ${TABLE.STOCK_HOLD} WHERE inventory_oid = i.oid AND status = 'Active') h ON true
                    WHERE poi.pre_order_oid = $1
                    GROUP BY poi.oid, p.oid
                    ORDER BY p.name`,
            values: [oid],
        });
        return res.status(200).json({ code: 200, message: "Pre-order to convert", data: { ...booking, lines } });
    } catch (e) {
        log.error(`An exception occurred while reading a pre-order to convert: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not open the pre-order. Try again in a moment." });
    }
};

module.exports = get_pre_order_for_conversion;
