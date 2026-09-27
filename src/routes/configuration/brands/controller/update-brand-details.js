const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");
const { duplicate_conflict } = require("../utils/duplicate");

const update_brand_details = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;

      let changed = true;

      try {
            await execute_transaction(async (tx) => {
                  const rows = await tx.get_data({
                        text: `SELECT name, description, origin_country, status FROM ${TABLE.BRANDS} WHERE oid = $1 FOR UPDATE`,
                        values: [payload.oid],
                  });

                  if (!rows.length) fail(404, "That brand no longer exists. It may have been removed.");

                  // Saving an untouched form writes nothing, so the timeline records only real changes.
                  const changes = detectChanges(rows[0], payload);
                  if (!changes.length) {
                        changed = false;
                        return;
                  }

                  const updated = await tx.execute_value({
                        text: `UPDATE ${TABLE.BRANDS} SET name = $1, description = $2, origin_country = $3, status = $4, edited_on = clock_timestamp(), edited_by = $5 WHERE oid = $6`,
                        values: [payload.name, payload.description, payload.origin_country, payload.status, user_id, payload.oid],
                  });

                  if (updated.rowCount !== 1) fail(404, "That brand no longer exists. It may have been removed.");

                  await saveLogActivity(
                        {
                              reference_type: "brand",
                              reference_oid: payload.oid,
                              title: "Updated brand",
                              description: generateChangeDescription(`brand "${payload.name}"`, changes),
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message });

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Brand not updated, ${conflict.field} already taken by another brand`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }

            log.error(`An exception occurred while updating brand : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      if (!changed) return res.status(200).json({ code: 200, message: "Nothing changed.", data: { changed: false } });

      log.info(`Brand ${payload.name} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Brand Updated Successfully!",
      });
}

module.exports = update_brand_details
