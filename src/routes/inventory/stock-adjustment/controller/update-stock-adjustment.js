const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { REASON_LABEL, shape_lines, check_lines, insert_lines, delete_lines, units } = require("../utils/adjustment-rules");
const { BUDGETS } = require("../../utils/cost-budget");
const { v4: uuidv4 } = require("uuid");

const KEYS = ["product_oid", "direction", "quantity", "inventory_oid", "cost_price", "intended_use", "selling_price", "maximum_discount", "warehouse_oid", "aisle_oid", "expiry_date", ...BUDGETS, "cost_remarks"];
const line_key = (line) => KEYS.map((key) => (line[key] === null || line[key] === undefined ? "" : String(line[key]))).join("|");

// Lines are replaced wholesale: nothing points at a line until the adjustment is verified. A Draft
// saved again stays a Draft; saved with draft false it is submitted, with every check. A Submitted
// adjustment stays Submitted and never goes back to a Draft, as a purchase order.
const update_stock_adjustment = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      let changed = true;
      let status;

      try {
            await execute_transaction(async (tx) => {
                  const [adjustment] = await tx.get_data({ text: `SELECT adjustment_number, status, reason, note FROM ${TABLE.STOCK_ADJUSTMENT} WHERE oid = $1 FOR UPDATE`, values: [payload.oid] });
                  if (!adjustment) fail(404, "That adjustment no longer exists.");
                  if (adjustment.status !== "Draft" && adjustment.status !== "Submitted") fail(409, `This adjustment is ${adjustment.status} and can no longer be edited.`, { status: adjustment.status });
                  const was_draft = adjustment.status === "Draft";
                  if (!was_draft && payload.draft) fail(409, "A submitted adjustment cannot go back to a draft.", { status: adjustment.status });

                  const lines = shape_lines(payload.reason, payload.lines);
                  await check_lines(tx, lines, !payload.draft);
                  status = was_draft && !payload.draft ? "Submitted" : adjustment.status;

                  const stored = await tx.get_data({
                        text: `SELECT l.product_oid, l.direction, l.quantity, l.inventory_oid, l.cost_price::bigint AS cost_price, l.intended_use, l.selling_price::bigint AS selling_price, l.maximum_discount::bigint AS maximum_discount,
                                      l.warehouse_oid, l.aisle_oid, to_char(l.expiry_date, 'YYYY-MM-DD') AS expiry_date,
                                      ${BUDGETS.map((key) => `b.${key}::bigint AS ${key}`).join(", ")}, b.cost_remarks
                                 FROM ${TABLE.STOCK_ADJUSTMENT_LINE} l LEFT JOIN ${TABLE.COST_BUDGET} b ON b.stock_adjustment_line_oid = l.oid
                                WHERE l.adjustment_oid = $1`,
                        values: [payload.oid],
                  });
                  const lines_changed = stored.map(line_key).sort().join(",") !== lines.map(line_key).sort().join(",");
                  const header_changed = adjustment.reason !== payload.reason || (adjustment.note ?? null) !== payload.note;
                  if (!lines_changed && !header_changed && status === adjustment.status) {
                        changed = false;
                        return;
                  }

                  const updated = await tx.execute_value({
                        text: `UPDATE ${TABLE.STOCK_ADJUSTMENT}
                                  SET reason = $1, note = $2, status = $3::varchar, edited_by = $4, edited_on = clock_timestamp(),
                                      submitted_by = CASE WHEN $3::varchar = 'Submitted' AND status = 'Draft' THEN $4 ELSE submitted_by END,
                                      submitted_on = CASE WHEN $3::varchar = 'Submitted' AND status = 'Draft' THEN clock_timestamp() ELSE submitted_on END
                                WHERE oid = $5 AND status = $6`,
                        values: [payload.reason, payload.note, status, user_id, payload.oid, adjustment.status],
                  });
                  if (updated.rowCount !== 1) fail(409, "This adjustment changed while you were editing it. Reload it and try again.");

                  if (lines_changed) {
                        await delete_lines(tx, payload.oid);
                        await insert_lines(tx, payload.oid, lines, user_id, uuidv4);
                  }

                  await saveLogActivity(
                        {
                              reference_type: "stock-adjustment",
                              reference_oid: payload.oid,
                              title: was_draft ? (status === "Submitted" ? "Submitted" : "Draft saved") : "Edited",
                              description: `${adjustment.adjustment_number}: ${REASON_LABEL[payload.reason]}, ${lines.length} line${lines.length === 1 ? "" : "s"}, ${units(lines)} units`,
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while updating stock adjustment ${payload.oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not save the adjustment. Try again in a moment." });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false, status } });
      log.info(`Stock adjustment ${payload.oid} saved as ${status} by ${user_id}`);
      return res.status(200).json({ code: 200, message: status === "Draft" ? "Draft saved" : "Adjustment saved", data: { changed: true, status } });
};

module.exports = update_stock_adjustment;
