const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

// The same row the Warehouses list carries, plus the warehouse it belongs to.
const SELECT = `a.oid, a.name, a.code, a.warehouse_oid, a.storage_type, a.capacity_units, a.special_notes, a.status, a.created_on,
                w.name AS warehouse_name,
                COALESCE(a.edited_on, a.created_on) AS last_action_on,
                COALESCE(a.edited_by, a.created_by) AS last_action_by,
                (a.edited_by IS NOT NULL) AS last_action_is_edit,
                u.name AS last_action_by_name,
                r.name AS last_action_by_role`;

const FROM = `${TABLE.AISLE} a
              JOIN ${TABLE.WAREHOUSE} w ON w.oid = a.warehouse_oid
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = COALESCE(a.edited_by, a.created_by)
              LEFT JOIN ${TABLE.ROLE} r ON r.oid = u.role_oid`;

const STOCK_HERE = `EXISTS (SELECT 1 FROM ${TABLE.INVENTORY} i JOIN ${TABLE.PURCHASE_DETAILS} d ON d.oid = i.purchase_details_oid WHERE d.aisle_oid = a.oid AND i.quantity_available > 0)`;

const STATS = {
    active: `COUNT(*) FILTER (WHERE a.status = 'Active')::int`,
    inactive: `COUNT(*) FILTER (WHERE a.status = 'Inactive')::int`,
    stocked: `COUNT(*) FILTER (WHERE ${STOCK_HERE})::int`,
    empty: `COUNT(*) FILTER (WHERE NOT ${STOCK_HERE})::int`,
};

const get_aisle_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            search: ["a.name", "a.code", "w.name"],
            filters: { status: "a.status", warehouse_oid: "a.warehouse_oid" },
            sortable: { name: "a.name", code: "a.code", warehouse_name: "w.name", status: "a.status", created_on: "a.created_on", last_action_on: "COALESCE(a.edited_on, a.created_on)" },
            default_sort: { key: "name", order: "asc" },
            stats: STATS,
            tie_breaker: "a.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Aisles", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing aisles: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load aisles. Try again in a moment." });
    }
};

module.exports = get_aisle_list;
