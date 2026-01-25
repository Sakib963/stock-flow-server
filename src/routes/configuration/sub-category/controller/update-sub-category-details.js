const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");

const update_sub_category_details = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            // Get old data for comparison
            const oldDataSql = {
                  text: `SELECT name, description, category_code, category_oid, status FROM ${TABLE.SUB_CATEGORIES} WHERE oid = $1`,
                  values: [payload.oid]
            };
            const oldData = await get_data(oldDataSql);
            const oldSubCategory = oldData.length ? oldData[0] : null;

            const sql = {
                  text: `update ${TABLE.SUB_CATEGORIES} set name = $1, description = $2, category_code = $3, status = $4, edited_on = clock_timestamp(), edited_by = $5, category_oid = $6 where oid = $7`,
                  values: [payload.name, payload.description, payload.category_code, payload.status, user_id, payload.category_oid, payload.oid]
            }
            await execute_value(sql);
            
            // Automatically detect changes and generate description (non-blocking - fire and forget)
            if (oldSubCategory) {
                  // detectChanges automatically loops through payload and generates labels
                  const changes = detectChanges(oldSubCategory, payload);
                  const activityDescription = generateChangeDescription(`sub-category "${payload.name}"`, changes);
                  
                  saveLogActivity({
                        reference_type: 'sub-category',
                        reference_oid: payload.oid,
                        title: 'Updated sub-category',
                        performed_by: user_id,
                        description: activityDescription
                  });
            }
      } catch (e) {
            log.error(`An exception occurred while updating sub-category : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Sub-Category ${payload.name} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Sub-Category Updated Successfully!",
      });
}

module.exports = update_sub_category_details