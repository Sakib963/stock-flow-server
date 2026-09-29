const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

const SELECT = `s.oid, s.name, s.contact_person, s.phone_number, s.whatsapp_number, s.email, s.address, s.status, s.created_on,
                COALESCE(s.edited_on, s.created_on) AS last_action_on,
                COALESCE(s.edited_by, s.created_by) AS last_action_by,
                (s.edited_by IS NOT NULL) AS last_action_is_edit,
                u.name AS last_action_by_name,
                r.name AS last_action_by_role`;

const FROM = `${TABLE.SUPPLIER} s
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(s.edited_by, s.created_by)
              LEFT JOIN ${TABLE.ROLE} r ON r.oid = u.role_oid`;

// Owed follows payment_status over Verified orders, the same rule as the supplier's record page.
const OWED = `(SELECT COALESCE(SUM(p.total_amount - CASE p.payment_status WHEN 'paid' THEN p.total_amount WHEN 'partially_paid' THEN COALESCE(p.paid_amount, 0) ELSE 0 END), 0)
               FROM ${TABLE.PURCHASE} p WHERE p.supplier_oid = s.oid AND p.status = 'Verified')`;

const STATS = {
    active: `COUNT(*) FILTER (WHERE s.status = 'Active')::int`,
    inactive: `COUNT(*) FILTER (WHERE s.status = 'Inactive')::int`,
    owing: `COUNT(*) FILTER (WHERE ${OWED} > 0)::int`,
    unused: `COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ${TABLE.PURCHASE} p WHERE p.supplier_oid = s.oid AND p.status IN ('Submitted', 'Verified')))::int`,
};

const get_supplier_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            search: ["s.name", "s.contact_person", "s.phone_number", "s.whatsapp_number", "s.email"],
            filters: { status: "s.status" },
            sortable: { name: "s.name", contact_person: "s.contact_person", status: "s.status", created_on: "s.created_on", last_action_on: "COALESCE(s.edited_on, s.created_on)" },
            default_sort: { key: "name", order: "asc" },
            stats: STATS,
            tie_breaker: "s.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Suppliers", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing suppliers: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load suppliers. Try again in a moment." });
    }
};

module.exports = get_supplier_list;
