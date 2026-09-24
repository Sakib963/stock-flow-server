const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");
const { duplicate_conflict } = require("../utils/duplicate");

const update_category_details = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;

      try {
            // The read and the write are one transaction on one connection, with the row locked.
            // Split apart they were two connections and two moments: the activity log described a
            // change from a snapshot that a concurrent update had already replaced, so the timeline
            // recorded a status change that the row no longer had.
            await execute_transaction(async (tx) => {
                  const rows = await tx.get_data({
                        text: `SELECT name, description, category_code, status FROM ${TABLE.CATEGORIES} WHERE oid = $1 FOR UPDATE`,
                        values: [payload.oid],
                  });

                  if (!rows.length) fail(404, "That category no longer exists. It may have been removed.");

                  const updated = await tx.execute_value({
                        text: `update ${TABLE.CATEGORIES} set name = $1, description = $2, category_code = $3, status = $4, edited_on = clock_timestamp(), edited_by = $5 where oid = $6`,
                        values: [payload.name, payload.description, payload.category_code, payload.status, user_id, payload.oid],
                  });

                  // The lock means this cannot be zero today. It is checked anyway, because the
                  // alternative is answering "Updated Successfully" having written nothing.
                  if (updated.rowCount !== 1) fail(404, "That category no longer exists. It may have been removed.");

                  await saveLogActivity(
                        {
                              reference_type: "category",
                              reference_oid: payload.oid,
                              title: "Updated category",
                              description: generateChangeDescription(`category "${payload.name}"`, detectChanges(rows[0], payload)),
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Category not updated, ${conflict.field} already taken by another category`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }

            log.error(`An exception occurred while updating category : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Category ${payload.name} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Category Updated Successfully!",
      });
}

module.exports = update_category_details
