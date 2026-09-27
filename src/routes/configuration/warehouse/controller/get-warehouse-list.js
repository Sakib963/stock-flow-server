const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

const SELECT = `w.oid, w.name, w.code, w.location, w.capacity_units, w.status, w.created_on,
                COALESCE(w.edited_on, w.created_on) AS last_action_on,
                COALESCE(w.edited_by, w.created_by) AS last_action_by,
                (w.edited_by IS NOT NULL) AS last_action_is_edit,
                u.name AS last_action_by_name,
                r.name AS last_action_by_role`;

const FROM = `${TABLE.WAREHOUSE} w
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(w.edited_by, w.created_by)
              LEFT JOIN ${TABLE.ROLE} r ON r.oid = u.role_oid`;

// Stock sits where its purchase order line was received; see utils/warehouse-stats.js.
const STOCK_HERE = `EXISTS (SELECT 1 FROM ${TABLE.INVENTORY} i JOIN ${TABLE.PURCHASE_DETAILS} d ON d.oid = i.purchase_details_oid WHERE d.warehouse_oid = w.oid AND i.quantity_available > 0)`;

const STATS = {
    active: `COUNT(*) FILTER (WHERE w.status = 'Active')::int`,
    inactive: `COUNT(*) FILTER (WHERE w.status = 'Inactive')::int`,
    stocked: `COUNT(*) FILTER (WHERE ${STOCK_HERE})::int`,
    empty: `COUNT(*) FILTER (WHERE NOT ${STOCK_HERE})::int`,
};

const get_warehouse_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            search: ["w.name", "w.code", "w.location"],
            filters: { status: "w.status" },
            sortable: { name: "w.name", code: "w.code", status: "w.status", created_on: "w.created_on", last_action_on: "COALESCE(w.edited_on, w.created_on)" },
            default_sort: { key: "name", order: "asc" },
            stats: STATS,
            tie_breaker: "w.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Warehouses", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing warehouses: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load warehouses. Try again in a moment." });
    }
};

module.exports = get_warehouse_list;
