const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { getLogActivities } = require("../../../../utils/activity-logger");
const { SELLABLE_BY_PRODUCT_CTE } = require("../../../../utils/pre-order-utils");
const { log } = require("../../../../utils/log");

// Detail payload: { details, items, stats, activity } (FR-35).
// `items` carries per-line stock readiness so the page can gate Create Order
// without a second round trip.
const get_pre_order_details = async (request, res) => {
    try {
        const preOrderOid = request.params.oid;

        const details_set = await get_data(generate_details_sql(preOrderOid));
        const details = details_set.length ? details_set[0] : null;

        if (!details) {
            log.warn(`Pre-order not found for oid: ${preOrderOid}`);
            return res.status(404).json({ code: 404, message: "Pre-order not found" });
        }

        const [items, stats_set, activity_set] = await Promise.all([
            get_data(generate_items_sql(preOrderOid)),
            get_data(generate_stats_sql(preOrderOid)),
            getLogActivities("pre_order", preOrderOid, 10),
        ]);

        const stats = stats_set.length ? stats_set[0] : {};
        const isReady = items.length > 0 && items.every((i) => i.is_ready);

        log.info(`Pre-order details found for oid: ${preOrderOid}`);
        return res.status(200).json({
            code: 200,
            message: "Pre-order details found successfully",
            data: {
                details,
                items,
                stats: {
                    totalValue: parseInt(stats.total_value) || 0,
                    advanceHeld: parseInt(stats.advance_held) || 0,
                    balanceDue: parseInt(stats.balance_due) || 0,
                    itemCount: parseInt(stats.item_count) || 0,
                    totalUnits: parseInt(stats.total_units) || 0,
                    daysSinceBooking: parseInt(stats.days_since_booking) || 0,
                    daysToExpected: stats.days_to_expected === null || stats.days_to_expected === undefined ? null : parseInt(stats.days_to_expected),
                    isReadyToConvert: isReady,
                },
                activity: activity_set.map((a) => ({
                    action: a.title,
                    description: a.description,
                    user: a.performed_by,
                    date: a.performed_on,
                })),
            },
        });
    } catch (e) {
        log.error(`An exception occurred while getting pre-order details: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
    }
};

const generate_details_sql = (oid) => ({
    text: `
        SELECT po.oid,
               po.preorder_no,
               po.customer_oid,
               po.customer_name,
               po.customer_phone,
               po.customer_email,
               po.customer_address,
               po.delivery_city,
               po.delivery_zone,
               po.delivery_area,
               po.delivery_postcode,
               CAST(po.subtotal AS INTEGER) AS subtotal,
               CAST(po.discount_total AS INTEGER) AS discount_total,
               CAST(po.delivery_charge AS INTEGER) AS delivery_charge,
               CAST(po.total_amount AS INTEGER) AS total_amount,
               CAST(po.advance_paid AS INTEGER) AS advance_paid,
               po.advance_method,
               po.advance_reference,
               CAST(po.advance_refunded AS INTEGER) AS advance_refunded,
               po.refunded_on,
               po.expected_date,
               po.status,
               po.confirmed_on,
               po.converted_on,
               po.converted_order_oid,
               o.invoice_no AS converted_invoice_no,
               po.cancelled_on,
               po.cancel_reason,
               po.notes,
               po.created_by,
               po.created_on,
               po.edited_by,
               po.edited_on
          FROM ${TABLE.PRE_ORDERS} po
          LEFT JOIN ${TABLE.ORDERS} o ON o.oid = po.converted_order_oid
         WHERE po.oid = $1
    `,
    values: [oid],
});

// Lines plus live readiness (FR-34). A pre-order line has no batch, so readiness
// is judged on total SELLABLE stock for the product.
const generate_items_sql = (oid) => ({
    text: `
        WITH sellable AS (${SELLABLE_BY_PRODUCT_CTE})
        SELECT poi.oid,
               poi.product_oid,
               poi.product_name,
               p.sku,
               CAST(poi.quantity AS INTEGER) AS quantity,
               CAST(poi.unit_price AS INTEGER) AS unit_price,
               CAST(COALESCE(poi.discount, 0) AS INTEGER) AS discount,
               CAST(poi.total AS INTEGER) AS total,
               COALESCE(s.sellable_quantity, 0) AS sellable_quantity,
               (COALESCE(s.sellable_quantity, 0) >= poi.quantity) AS is_ready
          FROM ${TABLE.PRE_ORDER_ITEMS} poi
          LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = poi.product_oid
          LEFT JOIN sellable s ON s.product_oid = poi.product_oid
         WHERE poi.pre_order_oid = $1
         ORDER BY poi.product_name ASC
    `,
    values: [oid],
});

const generate_stats_sql = (oid) => ({
    text: `
        WITH line_stats AS (
            SELECT COUNT(*)::int AS item_count,
                   COALESCE(SUM(quantity), 0)::int AS total_units
              FROM ${TABLE.PRE_ORDER_ITEMS}
             WHERE pre_order_oid = $1
        )
        SELECT CAST(po.total_amount AS INTEGER) AS total_value,
               CAST(po.advance_paid - po.advance_refunded AS INTEGER) AS advance_held,
               CAST(po.total_amount - po.advance_paid AS INTEGER) AS balance_due,
               ls.item_count,
               ls.total_units,
               (CURRENT_DATE - po.created_on::date)::int AS days_since_booking,
               CASE WHEN po.expected_date IS NULL THEN NULL
                    ELSE (po.expected_date - CURRENT_DATE)::int
               END AS days_to_expected
          FROM ${TABLE.PRE_ORDERS} po
          CROSS JOIN line_stats ls
         WHERE po.oid = $1
    `,
    values: [oid],
});

module.exports = get_pre_order_details;
