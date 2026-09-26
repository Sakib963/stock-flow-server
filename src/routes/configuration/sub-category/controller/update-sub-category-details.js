const { TABLE } = require("../../../../utils/constant");
const { execute_transaction, TransactionError, fail } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");
const { duplicate_conflict } = require("../utils/duplicate");
const { require_active_parent } = require("../utils/parent");

const GONE = "That sub-category no longer exists. It may have been removed.";

const update_sub_category_details = async (request, res) => {
      const payload = request.body;
      const user_id = request.credentials.user_id;

      try {
            await execute_transaction(async (tx) => {
                  const rows = await tx.get_data({
                        text: `SELECT name, description, category_code, category_oid, status FROM ${TABLE.SUB_CATEGORIES} WHERE oid = $1 FOR UPDATE`,
                        values: [payload.oid],
                  });

                  if (!rows.length) fail(404, GONE);

                  // A sub-category may stay under a parent that was turned Inactive after it was
                  // made. Moving it is a new choice, and a new choice must be an Active category.
                  if (rows[0].category_oid !== payload.category_oid) await require_active_parent(tx, payload.category_oid);

                  const updated = await tx.execute_value({
                        text: `UPDATE ${TABLE.SUB_CATEGORIES} SET name = $1, description = $2, category_code = $3, category_oid = $4, status = $5, edited_on = clock_timestamp(), edited_by = $6 WHERE oid = $7`,
                        values: [payload.name, payload.description, payload.category_code, payload.category_oid, payload.status, user_id, payload.oid],
                  });

                  if (updated.rowCount !== 1) fail(404, GONE);

                  // A product carries its category as well as its sub-category. Left behind, the old
                  // category's page would keep counting these products and the new one would miss them.
                  if (rows[0].category_oid !== payload.category_oid) {
                        await tx.execute_value({
                              text: `UPDATE ${TABLE.PRODUCT} SET category_oid = $1 WHERE sub_category_oid = $2`,
                              values: [payload.category_oid, payload.oid],
                        });
                  }

                  await saveLogActivity(
                        {
                              reference_type: "sub-category",
                              reference_oid: payload.oid,
                              title: "Updated sub-category",
                              description: generateChangeDescription(`sub-category "${payload.name}"`, detectChanges(rows[0], payload)),
                        },
                        { tx, request }
                  );
            });
      } catch (e) {
            if (e instanceof TransactionError) return res.status(e.code).json({ code: e.code, message: e.message, data: e.data });

            const conflict = duplicate_conflict(e);
            if (conflict) {
                  log.warn(`Sub-category not updated, ${conflict.field} already taken`);
                  return res.status(409).json({ code: 409, message: conflict.message, data: { field: conflict.field } });
            }

            log.error(`An exception occurred while updating sub-category : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Sub-category ${payload.name} updated successfully by : ${user_id}`);
      return res.status(200).json({ code: 200, message: "Sub-Category Updated Successfully!" });
};

module.exports = update_sub_category_details;
