const { TABLE } = require("../../../../utils/constant");

// An online order as the order page fills its form from it: a draft to resume, or a Pending order to
// edit. Each line's batch is read as it is now (the price saving will charge, and how many are free to
// sell, counting the units this order already holds as its own), and the address with its places named.
const read_orders_for_form = (get_data, where, values) =>
    get_data({
        text: `SELECT o.oid, o.invoice_no, o.draft_label, o.customer_name, o.customer_phone, o.notes, o.payment_type, o.payment_method, o.payment_reference,
                      o.amount_paid::int AS amount_paid, o.delivery_charge::int AS delivery_charge, o.total_amount::int AS total_amount, o.created_on, saver.name AS saved_by,
                      oo.source_oid, oo.customer_address_oid, oo.recipient_name, oo.recipient_phone, oo.address_line, oo.area_text, oo.postal_code,
                      oo.district_oid, d.name_en AS district_name_en, d.name_bn AS district_name_bn, oo.thana_oid, t.name_en AS thana_name_en, t.name_bn AS thana_name_bn,
                      (SELECT json_agg(json_build_object(
                                  'inventory_oid', oi.inventory_oid, 'product_oid', oi.product_oid, 'product_name', p.name, 'image_url', p.photo, 'batch_code', i.batch_code,
                                  'quantity', oi.quantity::int, 'discount', COALESCE(oi.discount, 0)::int,
                                  'selling_price', i.selling_price::int, 'maximum_discount', COALESCE(i.maximum_discount, 0)::int, 'expiry_date', i.expiry_date,
                                  'sellable', (i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM ${TABLE.STOCK_HOLD} h WHERE h.inventory_oid = i.oid AND h.status = 'Active' AND h.order_oid <> o.oid), 0))::int
                              ) ORDER BY p.name, i.batch_code)
                         FROM ${TABLE.ORDER_ITEMS} oi
                         JOIN ${TABLE.INVENTORY} i ON i.oid = oi.inventory_oid
                         JOIN ${TABLE.PRODUCT} p ON p.oid = oi.product_oid
                        WHERE oi.order_oid = o.oid) AS lines
                 FROM ${TABLE.ORDERS} o
            LEFT JOIN ${TABLE.ONLINE_ORDER} oo ON oo.order_oid = o.oid
            LEFT JOIN ${TABLE.DISTRICT} d ON d.oid = oo.district_oid
            LEFT JOIN ${TABLE.THANA} t ON t.oid = oo.thana_oid
            LEFT JOIN ${TABLE.LOGIN} saver ON saver.email = o.created_by
                WHERE o.channel = 'ONLINE' AND ${where}
             ORDER BY o.created_on`,
        values,
    });

module.exports = { read_orders_for_form };
