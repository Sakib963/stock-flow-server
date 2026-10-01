const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { log } = require("../../../../utils/log");
const { check_lines, insert_lines, delete_lines, write_totals, describe } = require("../utils/dispose-rules");
const { v4: uuidv4 } = require("uuid");

const KEYS = ["product_oid", "inventory_oid", "quantity", "reason", "line_note"];
const line_key = (line) => KEYS.map((key) => (line[key] === null || line[key] === undefined ? "" : String(line[key]))).join("|");

// Lines are replaced wholesale: nothing points at a line until the disposal is approved. A Draft
// saved again stays a Draft; saved with draft false it is submitted. A Submitted disposal never goes
// back to a Draft.
const update_product_dispose = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;
      let changed = true;
      let status;

      try {
            await execute_transaction(async (tx) => {
                  const [disposal] = await tx.get_data({ text: `SELECT dispose_no, status, disposal_method, notes FROM ${TABLE.PRODUCT_DISPOSE} WHERE oid = $1 FOR UPDATE`, values: [payload.oid] });
                  if (!disposal) fail(404, "That disposal no longer exists.");
                  if (disposal.status !== "Draft" && disposal.status !== "Submitted") fail(409, `This disposal is ${disposal.status} and can no longer be edited.`, { status: disposal.status });
                  const was_draft = disposal.status === "Draft";
                  if (!was_draft && payload.draft) fail(409, "A submitted disposal cannot go back to a draft.", { status: disposal.status });

                  await check_lines(tx, payload.lines, !payload.draft);
                  status = was_draft && !payload.draft ? "Submitted" : disposal.status;

                  const stored = await tx.get_data({ text: `SELECT product_oid, inventory_oid, dispose_quantity::int AS quantity, reason, line_note FROM ${TABLE.DISPOSE_DETAILS} WHERE dispose_oid = $1`, values: [payload.oid] });
                  const lines_changed = stored.map(line_key).sort().join(",") !== payload.lines.map(line_key).sort().join(",");
                  const header_changed = (disposal.disposal_method ?? null) !== payload.method || (disposal.notes ?? null) !== payload.note;
                  if (!lines_changed && !header_changed && status === disposal.status) {
                        changed = false;
                        return;
                  }

                  const updated = await tx.execute_value({
                        text: `UPDATE ${TABLE.PRODUCT_DISPOSE}
                                  SET disposal_method = $1, notes = $2, status = $3::varchar, edited_by = $4, edited_on = clock_timestamp(),
                                      submitted_by = CASE WHEN $3::varchar = 'Submitted' AND status = 'Draft' THEN $4 ELSE submitted_by END,
                                      submitted_on = CASE WHEN $3::varchar = 'Submitted' AND status = 'Draft' THEN clock_timestamp() ELSE submitted_on END
                                WHERE oid = $5 AND status = $6`,
                        values: [payload.method, payload.note, status, user_id, payload.oid, disposal.status],
                  });
                  if (updated.rowCount !== 1) fail(409, "This disposal changed while you were editing it. Reload it and try again.");

                  if (lines_changed) {
                        await delete_lines(tx, payload.oid);
                        await insert_lines(tx, payload.oid, payload.lines, user_id, uuidv4);
                        await write_totals(tx, payload.oid);
                  }
                  await saveLogActivity(
                        { reference_type: "product-dispose", reference_oid: payload.oid, title: was_draft ? (status === "Submitted" ? "Submitted" : "Draft saved") : "Edited", description: describe(disposal.dispose_no, payload.lines) },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });
            log.error(`An exception occurred while updating disposal ${payload.oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not save the disposal. Try again in a moment." });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false, status } });
      log.info(`Disposal ${payload.oid} saved as ${status} by ${user_id}`);
      return res.status(200).json({ code: 200, message: status === "Draft" ? "Draft saved" : "Disposal saved", data: { changed: true, status } });
};

module.exports = update_product_dispose;
