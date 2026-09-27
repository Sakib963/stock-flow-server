const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");
const { duplicate_conflict } = require("../utils/duplicate");

const GONE = "That warehouse no longer exists. It may have been removed.";

const update_warehouse_details = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;

      let changed = true;

      try {
            await execute_transaction(async (tx) => {
                  const rows = await tx.get_data({
                        text: `SELECT name, code, location, capacity_units, status FROM ${TABLE.WAREHOUSE} WHERE oid = $1 FOR UPDATE`,
                        values: [payload.oid],
                  });

                  if (!rows.length) fail(404, GONE);

                  // Saving an untouched form writes nothing, so the timeline records only real changes.
                  const changes = detectChanges(rows[0], payload);
                  if (!changes.length) {
                        changed = false;
                        return;
                  }

                  const updated = await tx.execute_value({
                        text: `UPDATE ${TABLE.WAREHOUSE} SET name = $1, code = $2, location = $3, capacity_units = $4, status = $5, edited_on = clock_timestamp(), edited_by = $6 WHERE oid = $7`,
                        values: [payload.name, payload.code, payload.location, payload.capacity_units, payload.status, user_id, payload.oid],
                  });

                  if (updated.rowCount !== 1) fail(404, GONE);

                  await saveLogActivity(
                        {
                              reference_type: "warehouse",
                              reference_oid: payload.oid,
                              title: "Updated warehouse",
                              description: generateChangeDescription(`warehouse "${payload.name}"`, changes),
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Warehouse not updated, ${conflict.field} already taken by another warehouse`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }

            log.error(`An exception occurred while updating warehouse : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });

      log.info(`Warehouse ${payload.name} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Warehouse Updated Successfully!",
      });
}

module.exports = update_warehouse_details
