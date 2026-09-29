const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

// Paid follows payment_status, never the stored figure alone: two old orders are marked paid with
// less than their total against them.
const PAID = `CASE p.payment_status WHEN 'paid' THEN p.total_amount WHEN 'partially_paid' THEN COALESCE(p.paid_amount, 0) ELSE 0 END`;

const SELECT = `p.oid, p.po_number, p.supplier_oid, s.name AS supplier_name, p.purchase_type, p.status, p.payment_status,
                p.total_amount::bigint AS total_amount, (${PAID})::bigint AS paid_amount,
                to_char(p.expected_delivery_date, 'YYYY-MM-DD') AS expected_delivery_date,
                l.product_count, l.ordered_units, l.received_units, l.received_total,
                p.created_on, p.verified_on, p.cancelled_on,
                COALESCE(p.edited_on, p.created_on) AS last_action_on,
                COALESCE(p.edited_by, p.created_by) AS last_action_by,
                (p.edited_by IS NOT NULL) AS last_action_is_edit,
                u.name AS last_action_by_name,
                r.name AS last_action_by_role`;

const FROM = `${TABLE.PURCHASE} p
              JOIN ${TABLE.SUPPLIER} s ON s.oid = p.supplier_oid
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(p.edited_by, p.created_by)
              LEFT JOIN ${TABLE.ROLE} r ON r.oid = u.role_oid
              LEFT JOIN LATERAL (
                  SELECT COUNT(*)::int AS product_count,
                         COALESCE(SUM(d.ordered_quantity), 0)::int AS ordered_units,
                         SUM(d.verified_quantity)::int AS received_units,
                         SUM(d.verified_quantity * d.verified_unit_price)::bigint AS received_total
                    FROM ${TABLE.PURCHASE_DETAILS} d
                   WHERE d.purchase_oid = p.oid
              ) l ON TRUE`;

const OVERDUE = `p.status = 'Submitted' AND p.expected_delivery_date < CURRENT_DATE`;

const STATS = {
    submitted: `COUNT(*) FILTER (WHERE p.status = 'Submitted')::int`,
    overdue: `COUNT(*) FILTER (WHERE ${OVERDUE})::int`,
    verified: `COUNT(*) FILTER (WHERE p.status = 'Verified')::int`,
    cancelled: `COUNT(*) FILTER (WHERE p.status = 'Cancelled')::int`,
};

const get_purchase_order_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            search: ["p.po_number", "s.name", "s.phone_number"],
            filters: { status: "p.status", payment_status: "p.payment_status", supplier_oid: "p.supplier_oid" },
            sortable: { po_number: "p.po_number", supplier_name: "s.name", total_amount: "p.total_amount", status: "p.status", created_on: "p.created_on", expected_delivery_date: "p.expected_delivery_date" },
            default_sort: { key: "created_on", order: "desc" },
            stats: STATS,
            tie_breaker: "p.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Purchase orders", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing purchase orders: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load purchase orders. Try again in a moment." });
    }
};

module.exports = get_purchase_order_list;
