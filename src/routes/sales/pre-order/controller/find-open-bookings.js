const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// A customer's open bookings, line by line, so the form can warn before the same product is booked
// twice for them. POSTed, so the phone stays out of URLs.
const find_open_bookings = async (request, res) => {
    try {
        const rows = await get_data({
            text: `SELECT po.oid, po.preorder_no, po.status, poi.product_oid, poi.quantity::int AS quantity
                     FROM ${TABLE.PRE_ORDERS} po
                     JOIN ${TABLE.CUSTOMERS} c ON c.oid = po.customer_oid
                     JOIN ${TABLE.PRE_ORDER_ITEMS} poi ON poi.pre_order_oid = po.oid
                    WHERE c.phone_normalized = $1 AND po.status IN ('Pending', 'Confirmed')
                    ORDER BY po.created_on`,
            values: [request.body.phone],
        });
        return res.status(200).json({ code: 200, message: "Open pre-orders", data: rows });
    } catch (e) {
        log.error(`An exception occurred while finding a customer's open pre-orders: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not check this customer's pre-orders. Try again in a moment." });
    }
};

module.exports = find_open_bookings;
