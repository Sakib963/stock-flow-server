const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");

const update_category_details = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            // Get old data for comparison
            const oldDataSql = {
                  text: `SELECT name, description, category_code, status FROM ${TABLE.CATEGORIES} WHERE oid = $1`,
                  values: [payload.oid]
            };
            const oldData = await get_data(oldDataSql);
            const oldCategory = oldData.length ? oldData[0] : null;

            const sql = {
                  text: `update ${TABLE.CATEGORIES} set name = $1, description = $2, category_code = $3, status = $4, edited_on = clock_timestamp(), edited_by = $5 where oid = $6`,
                  values: [payload.name, payload.description, payload.category_code, payload.status, user_id, payload.oid]
            }
            await execute_value(sql);
            
            // Automatically detect changes and generate description (non-blocking - fire and forget)
            if (oldCategory) {
                  const changes = detectChanges(oldCategory, {
                        name: payload.name,
                        description: payload.description,
                        category_code: payload.category_code,
                        status: payload.status
                  });
                  
                  const activityDescription = generateChangeDescription(`category "${payload.name}"`, changes);
                  
                  saveLogActivity({
                        reference_type: 'category',
                        reference_oid: payload.oid,
                        title: 'Updated category',
                        performed_by: user_id,
                        description: activityDescription
                  });
            }
      } catch (e) {
            log.error(`An exception occurred while updating category : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Category ${payload.email} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Category Updated Successfully!",
      });
}

module.exports = update_category_details