const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { BUDGETS, save_budget } = require("../../utils/cost-budget");

const LABEL = { ad_run_cost: "ad", packaging_cost: "packaging", gift_cost: "gift", content_creation_cost: "content", influencer_cost: "influencer" };

// Budgets are per unit and belong to the line that made the batch: its purchase line or its stock
// adjustment line. The unit cost is never changed here or anywhere after verify (decided by the user,
// 2026-10-01); a cost typed wrong is corrected by support in the database.
const update_batch_budget = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      let changed = true;

      try {
            await execute_transaction(async (tx) => {
                  const [batch] = await tx.get_data({
                        text: `SELECT i.batch_code, i.product_oid, i.purchase_details_oid, i.stock_adjustment_line_oid, p.name AS product_name
                                 FROM ${TABLE.INVENTORY} i JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
                                WHERE i.oid = $1
                                  FOR UPDATE OF i`,
                        values: [payload.inventory_oid],
                  });
                  if (!batch) fail(404, "That batch no longer exists.");
                  const owner = batch.purchase_details_oid ? "purchase_details_oid" : batch.stock_adjustment_line_oid ? "stock_adjustment_line_oid" : null;
                  if (!owner) fail(409, "This batch did not come from a purchase order or a stock adjustment, so it has no budgets to change.", { reason: "no_source_line" });

                  // Read after the lock is held: a join in the locking statement would keep the budget it
                  // saw before waiting, and a save racing another would compare against stale values.
                  const [current = {}] = await tx.get_data({
                        text: `SELECT ${BUDGETS.map((key) => `${key}::bigint AS ${key}`).join(", ")}, cost_remarks
                                 FROM ${TABLE.COST_BUDGET} WHERE ${owner} = $1`,
                        values: [batch[owner]],
                  });
                  const now = (key) => (current[key] === null || current[key] === undefined ? null : Number(current[key]));
                  const differs = BUDGETS.filter((key) => now(key) !== payload[key]);
                  const remark_changed = (current.cost_remarks ?? null) !== payload.cost_remarks;
                  if (!differs.length && !remark_changed) {
                        changed = false;
                        return;
                  }

                  await save_budget(tx, { owner, owner_oid: batch[owner], values: payload, user_id });

                  // Names what changed, never the amounts: the activity log is read by people who may not
                  // see what stock cost.
                  const parts = differs.map((key) => LABEL[key]);
                  if (remark_changed) parts.push("remark");
                  await saveLogActivity(
                        {
                              reference_type: "product-stock",
                              reference_oid: batch.product_oid,
                              title: "Budget changed",
                              description: `${batch.product_name}, batch ${batch.batch_code}: ${parts.join(", ")} changed`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while changing the budget of batch ${payload.inventory_oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not save the budget. Try again in a moment." });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });
      return res.status(200).json({ code: 200, message: "Budget saved", data: { changed: true } });
};

module.exports = update_batch_budget;
