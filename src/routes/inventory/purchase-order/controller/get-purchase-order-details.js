const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// Dates go out as ISO strings or plain YYYY-MM-DD: the old DD/MM/YYYY text was read month first by
// the date pipe, so 6 October showed as 10 June and any day past the 12th showed nothing.
const DETAILS_SQL = `
      SELECT p.oid, p.po_number, p.status, p.purchase_type, p.special_notes, p.cancel_reason,
             p.payment_status, p.total_amount::bigint AS total_amount,
             (CASE p.payment_status WHEN 'paid' THEN p.total_amount WHEN 'partially_paid' THEN COALESCE(p.paid_amount, 0) ELSE 0 END)::bigint AS paid_amount,
             to_char(p.expected_delivery_date, 'YYYY-MM-DD') AS expected_delivery_date,
             p.supplier_oid, s.name AS supplier_name, s.phone_number AS supplier_phone, s.status AS supplier_status,
             (SELECT COUNT(*)::int FROM ${TABLE.PURCHASE} x WHERE x.supplier_oid = p.supplier_oid AND x.status IN ('Submitted', 'Verified') AND date_trunc('year', x.created_on) = date_trunc('year', CURRENT_DATE)) AS supplier_orders_this_year,
             p.created_on, p.created_by, cu.name AS created_by_name,
             p.verified_on, p.verified_by, vu.name AS verified_by_name,
             p.cancelled_on, p.cancelled_by, xu.name AS cancelled_by_name,
             COALESCE(p.edited_on, p.created_on) AS last_action_on
        FROM ${TABLE.PURCHASE} p
        JOIN ${TABLE.SUPPLIER} s ON s.oid = p.supplier_oid
        LEFT JOIN ${TABLE.LOGIN} cu ON cu.email = p.created_by
        LEFT JOIN ${TABLE.LOGIN} vu ON vu.email = p.verified_by
        LEFT JOIN ${TABLE.LOGIN} xu ON xu.email = p.cancelled_by
       WHERE p.oid = $1`;

// Sellable now is shown against the restock level so a Submitted order says why it was raised. A
// line verified before this port can carry several batches (one order was verified three times), so
// batches come as a list, not a single column.
const LINES_SQL = `
      SELECT d.oid, d.product_oid, pr.name AS product_name, pr.sku, pr.restock_threshold::int AS restock_threshold,
             replace(pr.photo, '/image/upload/', '/image/upload/c_fill,w_48,h_48,f_auto,q_auto/') AS photo_thumb,
             d.warehouse_oid, w.name AS warehouse_name, d.aisle_oid, a.name AS aisle_name,
             d.ordered_quantity::int AS ordered_quantity, d.ordered_unit_price::bigint AS ordered_unit_price,
             d.verified_quantity::int AS received_quantity, d.verified_unit_price::bigint AS received_unit_price,
             st.sellable, cur.selling_price AS current_selling_price, cur.maximum_discount AS current_maximum_discount,
             cp.ad_run_cost::bigint AS ad_run_cost, cp.packaging_cost::bigint AS packaging_cost, cp.gift_cost::bigint AS gift_cost,
             cp.content_creation_cost::bigint AS content_creation_cost, cp.influencer_cost::bigint AS influencer_cost, cp.cost_remarks,
             COALESCE(b.batches, '[]'::json) AS batches
        FROM ${TABLE.PURCHASE_DETAILS} d
        JOIN ${TABLE.PRODUCT} pr ON pr.oid = d.product_oid
        LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = d.warehouse_oid
        LEFT JOIN ${TABLE.AISLE} a ON a.oid = d.aisle_oid
        LEFT JOIN ${TABLE.PURCHASE_DETAILS_COST_PROFILE} cp ON cp.purchase_details_oid = d.oid
        LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(GREATEST(i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM ${TABLE.STOCK_HOLD} h WHERE h.inventory_oid = i.oid AND h.status = 'Active'), 0), 0)), 0)::int AS sellable
              FROM ${TABLE.INVENTORY} i
             WHERE i.product_oid = d.product_oid AND i.status = 'ready_for_sale'
        ) st ON TRUE
        -- The price the product sells at today, from its newest priced batch, so verifying a
        -- delivery of a product already on sale keeps its price unless someone changes it.
        LEFT JOIN LATERAL (
            SELECT i.selling_price::bigint AS selling_price, i.maximum_discount::bigint AS maximum_discount
              FROM ${TABLE.INVENTORY} i
             WHERE i.product_oid = d.product_oid AND i.status = 'ready_for_sale' AND i.selling_price IS NOT NULL
             ORDER BY i.created_on DESC, i.oid
             LIMIT 1
        ) cur ON TRUE
        LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object(
                       'oid', i.oid, 'batch_code', i.batch_code, 'intended_use', i.intended_use, 'status', i.status,
                       'initial_quantity', i.initial_quantity::int, 'quantity_available', i.quantity_available::int,
                       'selling_price', i.selling_price::bigint, 'maximum_discount', i.maximum_discount::bigint
                   ) ORDER BY i.created_on, i.oid) AS batches
              FROM ${TABLE.INVENTORY} i
             WHERE i.purchase_details_oid = d.oid
        ) b ON TRUE
       WHERE d.purchase_oid = $1
       ORDER BY pr.name, d.oid`;

const get_purchase_order_details = async (request, res) => {
      const oid = request.params.oid;
      try {
            const [details] = await get_data({ text: DETAILS_SQL, values: [oid] });
            if (!details) return res.status(404).json({ code: 404, message: "That purchase order no longer exists.", data: null });

            const [lines, activity] = await Promise.all([get_data({ text: LINES_SQL, values: [oid] }), getLogActivities("purchase-order", oid, 20)]);

            const verified = details.status === "Verified";
            const sum = (pick) => lines.reduce((total, line) => total + Number(pick(line) ?? 0), 0);
            const stats = {
                  ordered_total: sum((line) => line.ordered_quantity * line.ordered_unit_price),
                  ordered_units: sum((line) => line.ordered_quantity),
                  received_total: verified ? sum((line) => line.received_quantity * line.received_unit_price) : null,
                  received_units: verified ? sum((line) => line.received_quantity) : null,
                  lines_short: verified ? lines.filter((line) => line.received_quantity < line.ordered_quantity).length : null,
                  units_short: verified ? sum((line) => line.ordered_quantity - line.received_quantity) : null,
                  price_changed: verified ? lines.filter((line) => Number(line.received_unit_price) !== Number(line.ordered_unit_price)).length : null,
                  batches: verified ? sum((line) => line.batches.length) : 0,
                  budgets_total: verified ? sum((line) => ["ad_run_cost", "packaging_cost", "gift_cost", "content_creation_cost", "influencer_cost"].reduce((per_unit, key) => per_unit + Number(line[key] ?? 0), 0) * line.received_quantity) : null,
                  warehouses: new Set(lines.map((line) => line.warehouse_oid)).size,
            };

            return res.status(200).json({
                  code: 200,
                  message: "Purchase order",
                  data: {
                        details,
                        lines,
                        stats,
                        activity: activity.map((a) => ({ oid: a.oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description })),
                  },
            });
      } catch (e) {
            log.error(`An exception occurred while reading purchase order ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load the purchase order. Try again in a moment." });
      }
};

module.exports = get_purchase_order_details;
