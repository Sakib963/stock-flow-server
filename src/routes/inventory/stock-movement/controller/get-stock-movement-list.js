const { TABLE } = require("../../../../utils/constant");
const { read_list } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

// The document behind a movement, by its reason: a received batch names its purchase order, a sale
// or dispatch its invoice, a return the invoice it came back from, a disposal or an adjustment its number.
const REFERENCE = `CASE WHEN m.reason = 'received' THEN pu.po_number
                        WHEN m.reason IN ('sold', 'dispatched') THEN o.invoice_no
                        WHEN m.reason = 'returned' THEN pr.invoice_no
                        WHEN m.reason IN ('disposed', 'dispose_reversed') THEN pd.dispose_no
                        WHEN m.reason IN ('adjusted', 'opening_stock') THEN sa.adjustment_number END`;

const SELECT = `m.oid, m.created_on, m.reason, m.quantity, m.balance_after,
                m.product_oid, p.name AS product_name, p.sku, i.batch_code,
                w.name AS warehouse_name, ${REFERENCE} AS reference,
                CASE WHEN m.reason = 'received' THEN m.source_oid END AS purchase_oid,
                CASE WHEN m.reason IN ('adjusted', 'opening_stock') THEN m.source_oid END AS adjustment_oid,
                m.created_by, u.name AS created_by_name`;

const FROM = `${TABLE.STOCK_MOVEMENT} m
              JOIN ${TABLE.PRODUCT} p ON p.oid = m.product_oid
              JOIN ${TABLE.INVENTORY} i ON i.oid = m.inventory_oid
              LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = i.warehouse_oid
              LEFT JOIN ${TABLE.PURCHASE} pu ON m.reason = 'received' AND pu.oid = m.source_oid
              LEFT JOIN ${TABLE.ORDERS} o ON m.reason IN ('sold', 'dispatched') AND o.oid = m.source_oid
              LEFT JOIN ${TABLE.PRODUCT_RETURN} pr ON m.reason = 'returned' AND pr.oid = m.source_oid
              LEFT JOIN ${TABLE.PRODUCT_DISPOSE} pd ON m.reason IN ('disposed', 'dispose_reversed') AND pd.oid = m.source_oid
              LEFT JOIN ${TABLE.STOCK_ADJUSTMENT} sa ON m.reason IN ('adjusted', 'opening_stock') AND sa.oid = m.source_oid
              LEFT JOIN ${TABLE.LOGIN} u ON u.email = m.created_by`;

const STATS = {
    // A carried over balance is where the ledger started, not stock that came in.
    units_in: `COALESCE(SUM(m.quantity) FILTER (WHERE m.quantity > 0 AND m.reason <> 'carried_over'), 0)::int`,
    units_out: `COALESCE(-SUM(m.quantity) FILTER (WHERE m.quantity < 0), 0)::int`,
};

const get_stock_movement_list = async (request, res) => {
    try {
        const { rows, total, stats } = await read_list({
            select: SELECT,
            from: FROM,
            search: ["p.name", "p.sku", "i.batch_code", REFERENCE],
            filters: { reason: "m.reason", product_oid: "m.product_oid" },
            sortable: { created_on: "m.created_on", product_name: "p.name", quantity: "m.quantity" },
            default_sort: { key: "created_on", order: "desc" },
            stats: STATS,
            tie_breaker: "m.oid",
            query: request.query,
        });
        return res.status(200).json({ code: 200, message: "Stock movements", data: stats ? { rows, stats } : { rows }, total });
    } catch (e) {
        log.error(`An exception occurred while listing stock movements: ${e?.message}`);
        return res.status(500).json({ code: 500, message: "Could not load stock movements. Try again in a moment." });
    }
};

module.exports = get_stock_movement_list;
