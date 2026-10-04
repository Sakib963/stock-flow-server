const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// Every parked cart, for every counter (sales REQ-19), with each line's batch as it is now: the price
// checkout will charge and how many are still free to sell, so a resumed cart shows what changed
// while it waited (REQ-24) before the cashier presses Checkout.
const get_parked_carts = async (request, res) => {
    try {
        const data = await get_data({
            text: `SELECT o.oid, o.invoice_no, o.draft_label, o.customer_name, o.customer_phone, o.notes, o.total_amount::int AS total_amount,
                          o.created_on, o.edited_on, parker.name AS parked_by,
                          json_agg(json_build_object(
                              'inventory_oid', oi.inventory_oid, 'product_oid', oi.product_oid, 'product_name', p.name, 'batch_code', i.batch_code,
                              'quantity', oi.quantity::int, 'discount', COALESCE(oi.discount, 0)::int,
                              'selling_price', i.selling_price::int, 'maximum_discount', COALESCE(i.maximum_discount, 0)::int, 'expiry_date', i.expiry_date,
                              'sellable', (i.quantity_available - COALESCE(h.held, 0))::int
                          ) ORDER BY p.name, i.batch_code) AS lines
                     FROM ${TABLE.ORDERS} o
                     JOIN ${TABLE.ORDER_ITEMS} oi ON oi.order_oid = o.oid
                     JOIN ${TABLE.INVENTORY} i ON i.oid = oi.inventory_oid
                     JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid
                LEFT JOIN (SELECT inventory_oid, SUM(quantity) AS held FROM ${TABLE.STOCK_HOLD} WHERE status = 'Active' GROUP BY inventory_oid) h ON h.inventory_oid = i.oid
                LEFT JOIN ${TABLE.LOGIN} parker ON parker.email = o.created_by
                    WHERE o.channel = 'POS' AND o.status = 'Draft'
                 GROUP BY o.oid, parker.name
                 ORDER BY o.created_on`,
            values: [],
        });
        return res.status(200).json({ code: 200, message: "Parked carts found", data });
    } catch (e) {
        log.error(`An exception occurred while reading parked carts: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the parked carts. Try again in a moment." });
    }
};

module.exports = get_parked_carts;
