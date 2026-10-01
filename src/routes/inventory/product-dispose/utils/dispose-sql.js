const { TABLE } = require("../../../../utils/constant");

const LINES_SQL = `
      SELECT l.oid, l.product_oid, p.name AS product_name, p.sku, p.unit_type,
             l.inventory_oid, i.batch_code, l.dispose_quantity::int AS quantity, l.reason, l.line_note,
             i.quantity_available::int AS on_hand,
             (i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM ${TABLE.STOCK_HOLD} h WHERE h.inventory_oid = i.oid AND h.status = 'Active'), 0))::int AS free,
             to_char(i.expiry_date, 'YYYY-MM-DD') AS expiry_date, w.name AS warehouse_name,
             l.cost_price::bigint AS cost_price, (l.dispose_quantity * l.cost_price)::bigint AS value
        FROM ${TABLE.DISPOSE_DETAILS} l
        JOIN ${TABLE.PRODUCT} p ON p.oid = l.product_oid
        LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = l.inventory_oid
        LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = i.warehouse_oid
       WHERE l.dispose_oid = $1
       ORDER BY l.created_on, l.oid`;

// Per disposal: its lines, units and value at cost.
const TOTALS = `
      LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS line_count, COALESCE(SUM(l.dispose_quantity), 0)::int AS units,
                 COALESCE(SUM(l.dispose_quantity * l.cost_price), 0)::float8 AS value
            FROM ${TABLE.DISPOSE_DETAILS} l
           WHERE l.dispose_oid = d.oid
      ) t ON TRUE`;

const MONEY_FIELDS = ["cost_price", "value", "value_this_month"];
const without_money = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !MONEY_FIELDS.includes(key)));

module.exports = { LINES_SQL, TOTALS, without_money };
