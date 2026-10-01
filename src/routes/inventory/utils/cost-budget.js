const { v4: uuidv4 } = require("uuid");
const { TABLE } = require("../../../utils/constant");

// Budgets are per unit and optional. A row belongs to the line they were entered on: a purchase line
// or a stock adjustment line, never both (cost_budget_owner_check).
const BUDGETS = ["ad_run_cost", "packaging_cost", "gift_cost", "content_creation_cost", "influencer_cost"];
const OWNERS = ["purchase_details_oid", "stock_adjustment_line_oid"];

const has_budget = (values) => BUDGETS.some((key) => values[key] !== null && values[key] !== undefined) || !!values.cost_remarks;

// Insert or replace the budget row a line owns. owner is one of OWNERS, interpolated only from that list.
const save_budget = async (tx, { owner, owner_oid, values, user_id }) => {
      if (!OWNERS.includes(owner)) throw new Error(`Unknown budget owner ${owner}`);
      await tx.execute_value({
            text: `INSERT INTO ${TABLE.COST_BUDGET} (oid, ${owner}, ${BUDGETS.join(", ")}, cost_remarks, created_by, created_on)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp())
                   ON CONFLICT (${owner}) DO UPDATE SET
                         ${BUDGETS.map((key) => `${key} = EXCLUDED.${key}`).join(", ")}, cost_remarks = EXCLUDED.cost_remarks,
                         edited_by = EXCLUDED.created_by, edited_on = clock_timestamp()`,
            values: [uuidv4(), owner_oid, ...BUDGETS.map((key) => values[key] ?? null), values.cost_remarks ?? null, user_id],
      });
};

module.exports = { BUDGETS, has_budget, save_budget };
