const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity, detectChanges, generateChangeDescription } = require("../../../../utils/activity-logger");

const update_brand_details = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            // Get old data for comparison
            const oldDataSql = {
                  text: `SELECT name, description, status FROM ${TABLE.BRANDS} WHERE oid = $1`,
                  values: [payload.oid]
            };
            const oldData = await get_data(oldDataSql);
            const oldBrand = oldData.length ? oldData[0] : null;
            const sql = {
                  text: `update ${TABLE.BRANDS} set name = $1, description = $2, status = $3, edited_on = clock_timestamp(), edited_by = $4 where oid = $5`,
                  values: [payload.name, payload.description, payload.status, user_id, payload.oid]
            }
            await execute_value(sql);
            
            // Automatically detect changes and generate description (non-blocking - fire and forget)
            if (oldBrand) {
                  // detectChanges automatically loops through payload and generates labels
                  const changes = detectChanges(oldBrand, payload);
                  const activityDescription = generateChangeDescription(`brand "${payload.name}"`, changes);
                  
                  saveLogActivity({
                        reference_type: 'brand',
                        reference_oid: payload.oid,
                        title: 'Updated brand',
                        performed_by: user_id,
                        description: activityDescription
                  });
            }
      } catch (e) {
            log.error(`An exception occurred while updating brand : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Brand ${payload.name} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Brand Updated Successfully!",
      });
}

module.exports = update_brand_details