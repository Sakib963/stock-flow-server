const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");
const { duplicate_conflict } = require("../utils/duplicate");
const { require_active_warehouse, refuse_move_with_stock } = require("../utils/parent");

const GONE = "That aisle no longer exists. It may have been removed.";

const update_aisle_details = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;

      let changed = true;

      try {
            await execute_transaction(async (tx) => {
                  const rows = await tx.get_data({
                        text: `SELECT name, code, warehouse_oid, storage_type, capacity_units, special_notes, status FROM ${TABLE.AISLE} WHERE oid = $1 FOR UPDATE`,
                        values: [payload.oid],
                  });

                  if (!rows.length) fail(404, GONE);

                  // Saving an untouched form writes nothing, so the timeline records only real changes.
                  const changes = detectChanges(rows[0], payload);
                  if (!changes.length) {
                        changed = false;
                        return;
                  }

                  if (rows[0].warehouse_oid !== payload.warehouse_oid) {
                        await refuse_move_with_stock(tx, payload.oid);
                        await require_active_warehouse(tx, payload.warehouse_oid);
                  }

                  const updated = await tx.execute_value({
                        text: `UPDATE ${TABLE.AISLE} SET name = $1, code = $2, warehouse_oid = $3, storage_type = $4, capacity_units = $5, special_notes = $6, status = $7, edited_on = clock_timestamp(), edited_by = $8 WHERE oid = $9`,
                        values: [payload.name, payload.code, payload.warehouse_oid, payload.storage_type, payload.capacity_units, payload.special_notes, payload.status, user_id, payload.oid],
                  });

                  if (updated.rowCount !== 1) fail(404, GONE);

                  await saveLogActivity(
                        {
                              reference_type: "aisle",
                              reference_oid: payload.oid,
                              title: "Updated aisle",
                              description: generateChangeDescription(`aisle "${payload.name}"`, changes),
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Aisle not updated, ${conflict.field} already taken`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }

            log.error(`An exception occurred while updating aisle : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });

      log.info(`Aisle ${payload.name} updated successfully by : ${user_id}`);
      return res.status(200).json({ code: 200, message: "Aisle Updated Successfully!" });
};

module.exports = update_aisle_details;
