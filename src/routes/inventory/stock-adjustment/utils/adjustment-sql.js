const { TABLE } = require("../../../../utils/constant");
const { BUDGETS } = require("../../utils/cost-budget");

// A line's batch is the one it moves, or the one it created on verification; its cost is the new
// batch's typed cost, or the existing batch's. Value is units times that cost.
const LINE_COST = `COALESCE(l.cost_price, i.cost_price)`;

const LINES_SQL = `
      SELECT l.oid, l.product_oid, p.name AS product_name, p.sku, p.has_expiry, p.unit_type,
             l.direction, l.quantity, l.inventory_oid, i.batch_code,
             i.quantity_available::int AS on_hand,
             (i.quantity_available - COALESCE((SELECT SUM(h.quantity) FROM ${TABLE.STOCK_HOLD} h WHERE h.inventory_oid = i.oid AND h.status = 'Active'), 0))::int AS free,
             (${LINE_COST})::bigint AS cost_price, (l.quantity * ${LINE_COST})::bigint AS value,
             l.intended_use, l.selling_price::bigint AS selling_price, l.maximum_discount::bigint AS maximum_discount,
             COALESCE(l.warehouse_oid, i.warehouse_oid) AS warehouse_oid, w.name AS warehouse_name,
             COALESCE(l.aisle_oid, i.aisle_oid) AS aisle_oid, a.name AS aisle_name,
             to_char(COALESCE(l.expiry_date, i.expiry_date), 'YYYY-MM-DD') AS expiry_date,
             ${BUDGETS.map((key) => `b.${key}::bigint AS ${key}`).join(", ")}, b.cost_remarks
        FROM ${TABLE.STOCK_ADJUSTMENT_LINE} l
        JOIN ${TABLE.PRODUCT} p ON p.oid = l.product_oid
        LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = l.inventory_oid
        LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = COALESCE(l.warehouse_oid, i.warehouse_oid)
        LEFT JOIN ${TABLE.AISLE} a ON a.oid = COALESCE(l.aisle_oid, i.aisle_oid)
        LEFT JOIN ${TABLE.COST_BUDGET} b ON b.stock_adjustment_line_oid = l.oid
       WHERE l.adjustment_oid = $1
       ORDER BY l.created_on, l.oid`;

// Per adjustment: its lines, units in and out, and their value at cost.
const TOTALS = `
      LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS line_count,
                 COALESCE(SUM(l.quantity) FILTER (WHERE l.direction = 'in'), 0)::int AS units_in,
                 COALESCE(SUM(l.quantity) FILTER (WHERE l.direction = 'out'), 0)::int AS units_out,
                 COALESCE(SUM(l.quantity * ${LINE_COST}) FILTER (WHERE l.direction = 'in'), 0)::float8 AS value_in,
                 COALESCE(SUM(l.quantity * ${LINE_COST}) FILTER (WHERE l.direction = 'out'), 0)::float8 AS value_out
            FROM ${TABLE.STOCK_ADJUSTMENT_LINE} l
            LEFT JOIN ${TABLE.INVENTORY} i ON i.oid = l.inventory_oid
           WHERE l.adjustment_oid = s.oid
      ) t ON TRUE`;

const MONEY_FIELDS = ["cost_price", "value", "value_in", "value_out", ...BUDGETS, "cost_remarks"];
const without_money = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !MONEY_FIELDS.includes(key)));

module.exports = { LINES_SQL, TOTALS, without_money };
