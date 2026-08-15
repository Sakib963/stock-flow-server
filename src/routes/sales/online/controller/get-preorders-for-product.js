const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

// Waiting list: pending PRE-ORDERS awaiting a given product. Use this when a
// shipment lands to see which pre-orders can now be converted.
const get_preorders_for_product = async (request, res) => {
    try {
        const product_oid = request.query.product_oid;
        const data = await get_data({
            text: `SELECT o.oid, o.invoice_no, o.customer_name, o.customer_phone, o.created_on,
                          CAST(oi.quantity AS INTEGER) AS quantity, oi.oid AS order_item_oid
                     FROM ${TABLE.ORDERS} o
                     JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
                    WHERE o.order_type = 'Preorder' AND o.status = 'Pending' AND oi.product_oid = $1
                    ORDER BY o.created_on ASC`,
            values: [product_oid],
        });
        const total_waiting = data.reduce((s, r) => s + Number(r.quantity), 0);
        log.info(`Pre-orders waiting on ${product_oid}: ${data.length} (${total_waiting} units)`);
        return res.status(200).json({ code: 200, message: "Waiting pre-orders found", total: data.length, data: { total_waiting, preorders: data } });
    } catch (e) {
        log.error(`An exception occurred while listing waiting pre-orders: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

module.exports = get_preorders_for_product;
