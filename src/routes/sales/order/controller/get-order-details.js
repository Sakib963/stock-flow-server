const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { channels_of } = require("../../utils/channels");
const { sees_addresses } = require("../../customer/utils/address");

const ADDRESS_FIELDS = ["customer_address", "delivery_city", "delivery_zone", "delivery_area", "delivery_postcode"];

// The order record page: header, lines, the online part (where it goes, how it was confirmed, the
// parcel) and the timeline. Only in the person's channels (sales REQ-02): an order outside them is not
// found, and someone who sells only at the counter never sees an address.
const get_order_details = async (request, res) => {
    try {
        const { oid } = request.query;
        const channels = await channels_of(request);
        const [header] = await get_data({
            text: `SELECT o.oid, o.invoice_no, o.channel, o.status, o.customer_oid, o.customer_name, o.customer_phone, o.customer_address,
                          o.subtotal::int AS subtotal, o.discount_total::int AS discount_total, o.delivery_charge::int AS delivery_charge,
                          o.total_amount::int AS total_amount, o.amount_paid::int AS amount_paid, o.amount_refunded::int AS amount_refunded,
                          o.payment_type, o.payment_method, o.payment_reference, o.payment_status, o.refund_status, o.refund_due::int AS refund_due,
                          o.dispatched_on, o.delivered_on, o.cancelled_on, o.cancel_reason_code, o.cancel_reason, o.sold_on, o.tracking_token,
                          o.notes, o.created_by, u.name AS created_by_name, o.created_on, o.edited_by, o.edited_on
                     FROM ${TABLE.ORDERS} o LEFT JOIN ${TABLE.LOGIN} u ON u.email = o.created_by
                    WHERE o.oid = $1 AND o.channel = ANY($2) AND o.status <> 'Draft' AND ($3::text IS NULL OR o.created_by = $3)`,
            values: [oid, channels, request.own_orders ? request.credentials.user_id : null],
        });
        if (!header) return res.status(404).json({ code: 404, message: "No order with that number in the channels you sell through." });

        const [items, history, online] = await Promise.all([
            get_data({
                text: `SELECT oi.oid, oi.inventory_oid, oi.product_oid, oi.product_name, i.batch_code,
                              oi.quantity::int AS quantity, oi.returned_qty::int AS returned_qty,
                              oi.unit_price::int AS unit_price, oi.discount::int AS discount, oi.total::int AS total
                         FROM ${TABLE.ORDER_ITEMS} oi LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = oi.inventory_oid
                        WHERE oi.order_oid = $1 ORDER BY oi.product_name, oi.oid`,
                values: [oid],
            }),
            get_data({
                text: `SELECT h.kind, h.from_status, h.to_status, h.reason, h.performed_by, u.name AS performed_by_name, h.performed_on
                         FROM ${TABLE.ORDER_STATUS_HISTORY} h LEFT JOIN ${TABLE.LOGIN} u ON u.email = h.performed_by
                        WHERE h.order_oid = $1 ORDER BY h.performed_on ASC, h.oid`,
                values: [oid],
            }),
            header.channel === "ONLINE"
                ? get_data({
                      text: `SELECT oo.recipient_name, oo.recipient_phone, oo.address_line, oo.area_text, oo.postal_code,
                                    d.name_en AS district_name_en, d.name_bn AS district_name_bn, t.name_en AS thana_name_en, t.name_bn AS thana_name_bn,
                                    s.name AS source_name, oo.confirmed_via, oo.confirmed_note, oo.confirmed_on, oo.confirmed_by,
                                    oo.risk_own_delivered_rate::float AS risk_own_delivered_rate, oo.risk_flag,
                                    oo.delivery_status, oo.packed_on, oo.courier, oo.consignment_no
                               FROM ${TABLE.ONLINE_ORDER} oo
                               LEFT JOIN ${TABLE.DISTRICT} d ON d.oid = oo.district_oid
                               LEFT JOIN ${TABLE.THANA} t ON t.oid = oo.thana_oid
                               LEFT JOIN ${TABLE.ORDER_SOURCE} s ON s.oid = oo.source_oid
                              WHERE oo.order_oid = $1`,
                      values: [oid],
                  })
                : [],
        ]);

        const order = sees_addresses(channels) ? header : Object.fromEntries(Object.entries(header).filter(([key]) => !ADDRESS_FIELDS.includes(key)));
        return res.status(200).json({ code: 200, message: "Order details", data: { ...order, items, status_history: history, online: online[0] ?? null } });
    } catch (e) {
        log.error(`An exception occurred while reading an order: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load the order. Try again in a moment." });
    }
};

module.exports = get_order_details;
