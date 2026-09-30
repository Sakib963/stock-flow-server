const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require("uuid");
const { BUDGETS } = require("../utils/stock-figures");

const LABEL = { ad_run_cost: "ad", packaging_cost: "packaging", gift_cost: "gift", content_creation_cost: "content", influencer_cost: "influencer" };

// Budgets are per unit and belong to the purchase line the batch came from, one line one batch since
// the port.
const update_batch_budget = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      let changed = true;

      try {
            await execute_transaction(async (tx) => {
                  const [batch] = await tx.get_data({
                        text: `SELECT i.batch_code, i.product_oid, i.purchase_details_oid, p.name AS product_name
                                 FROM ${TABLE.INVENTORY} i JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
                                WHERE i.oid = $1
                                  FOR UPDATE OF i`,
                        values: [payload.inventory_oid],
                  });
                  if (!batch) fail(404, "That batch no longer exists.");

                  // Read after the lock is held: a join in the locking statement would keep the budget it
                  // saw before waiting, and a save racing another would compare against stale values.
                  const [current = {}] = await tx.get_data({
                        text: `SELECT ${BUDGETS.map((key) => `${key}::bigint AS ${key}`).join(", ")}, cost_remarks
                                 FROM ${TABLE.PURCHASE_DETAILS_COST_PROFILE} WHERE purchase_details_oid = $1`,
                        values: [batch.purchase_details_oid],
                  });
                  const now = (key) => (current[key] === null || current[key] === undefined ? null : Number(current[key]));
                  const differs = BUDGETS.filter((key) => now(key) !== payload[key]);
                  const remark_changed = (current.cost_remarks ?? null) !== payload.cost_remarks;
                  if (!differs.length && !remark_changed) {
                        changed = false;
                        return;
                  }

                  await tx.execute_value({
                        text: `INSERT INTO ${TABLE.PURCHASE_DETAILS_COST_PROFILE} (oid, purchase_details_oid, ${BUDGETS.join(", ")}, cost_remarks, created_by, created_on)
                               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp())
                               ON CONFLICT (purchase_details_oid) DO UPDATE SET
                                     ${BUDGETS.map((key) => `${key} = EXCLUDED.${key}`).join(", ")}, cost_remarks = EXCLUDED.cost_remarks,
                                     edited_by = EXCLUDED.created_by, edited_on = clock_timestamp()`,
                        values: [uuidv4(), batch.purchase_details_oid, ...BUDGETS.map((key) => payload[key]), payload.cost_remarks, user_id],
                  });

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
