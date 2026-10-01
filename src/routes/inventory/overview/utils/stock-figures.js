const { TABLE } = require("../../../../utils/constant");
const { BUDGETS } = require("../../utils/cost-budget");

// One row per batch with what it holds and what it is worth. The list adds these up per product and
// the product page shows them, so the two can never disagree.
//
// Sellable is the rule of CLAUDE.md section 1: on hand less Active holds, ready_for_sale batches only,
// clamped at zero per batch (a disposal can take on hand below what is held).
//
// Money is per batch, never per product: the old overview took the cost of unpriced batches from the
// revenue of priced ones, so a product with one unpriced delivery read as a loss. Revenue and profit
// count priced batches for sale only, over on hand (held units are sold, not yet shipped); stock value
// counts every batch, because that money was spent whatever the stock is for. Budgets are per unit.
const BATCH_FIGURES = `
      SELECT i.oid, i.product_oid, i.batch_code, i.intended_use, i.status, i.created_on AS received_on,
             to_char(i.expiry_date, 'YYYY-MM-DD') AS expiry_date,
             i.initial_quantity::int AS initial_quantity,
             i.quantity_available::int AS on_hand, COALESCE(h.held, 0)::int AS held,
             (CASE WHEN i.status = 'ready_for_sale' THEN GREATEST(i.quantity_available - COALESCE(h.held, 0), 0) ELSE 0 END)::int AS sellable,
             i.cost_price::bigint AS cost_price, i.selling_price::bigint AS selling_price, i.maximum_discount::bigint AS maximum_discount,
             ${BUDGETS.map((key) => `cp.${key}::bigint AS ${key}`).join(", ")}, cp.cost_remarks,
             (${BUDGETS.map((key) => `COALESCE(cp.${key}, 0)`).join(" + ")})::bigint AS budget_per_unit,
             (i.intended_use = 'for_sale' AND i.status = 'ready_for_sale' AND i.selling_price IS NOT NULL) AS priced,
             i.purchase_details_oid, i.warehouse_oid, i.aisle_oid
        FROM ${TABLE.INVENTORY} i
        LEFT JOIN (SELECT inventory_oid, SUM(quantity) AS held FROM ${TABLE.STOCK_HOLD} WHERE status = 'Active' GROUP BY inventory_oid) h ON h.inventory_oid = i.oid
        LEFT JOIN ${TABLE.COST_BUDGET} cp ON cp.purchase_details_oid = i.purchase_details_oid OR cp.stock_adjustment_line_oid = i.stock_adjustment_line_oid`;

// Per product, over BATCH_FIGURES aliased b. The expiry window is the database's calendar day.
const PRODUCT_FIGURES = `
      SUM(b.on_hand)::int AS on_hand, SUM(b.held)::int AS held, SUM(b.sellable)::int AS sellable,
      COUNT(*) FILTER (WHERE b.on_hand > 0 OR b.held > 0)::int AS batches,
      COUNT(*) FILTER (WHERE b.on_hand > 0 AND b.intended_use = 'for_sale' AND NOT b.priced)::int AS unpriced_batches,
      COALESCE(SUM(b.on_hand) FILTER (WHERE b.expiry_date::date < CURRENT_DATE), 0)::int AS expired_units,
      COALESCE(SUM(b.on_hand) FILTER (WHERE b.expiry_date::date >= CURRENT_DATE AND b.expiry_date::date <= CURRENT_DATE + 30), 0)::int AS expiring_units,
      COALESCE(SUM(b.on_hand * b.cost_price), 0)::float8 AS stock_value,
      COALESCE(SUM(b.on_hand * b.cost_price) FILTER (WHERE b.intended_use = 'internal_use'), 0)::float8 AS internal_value,
      COALESCE(SUM(b.on_hand * b.cost_price) FILTER (WHERE b.expiry_date::date <= CURRENT_DATE + 30), 0)::float8 AS expiring_value,
      COALESCE(SUM(b.on_hand * b.selling_price) FILTER (WHERE b.priced), 0)::float8 AS expected_revenue,
      COALESCE(SUM(b.on_hand * (b.selling_price - b.cost_price - b.budget_per_unit)) FILTER (WHERE b.priced), 0)::float8 AS profit_full,
      COALESCE(SUM(b.on_hand * (b.selling_price - COALESCE(b.maximum_discount, 0) - b.cost_price - b.budget_per_unit)) FILTER (WHERE b.priced), 0)::float8 AS profit_discounted`;

// What someone without inventory.stock-value.view never receives: they are left out of the response,
// not hidden on the page, because a hidden column still reaches the browser (decided by the user,
// 2026-09-30).
const MONEY_FIELDS = ["cost_price", ...BUDGETS, "cost_remarks", "budget_per_unit", "stock_value", "internal_value", "expiring_value", "expected_revenue", "profit_full", "profit_discounted", "margin_per_unit"];

const without_money = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !MONEY_FIELDS.includes(key)));

module.exports = { BUDGETS, BATCH_FIGURES, PRODUCT_FIGURES, MONEY_FIELDS, without_money };
