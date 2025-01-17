const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const update_sub_category_details = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const sql = {
                  text: `update ${TABLE.SUB_CATEGORIES} set name = $1, description = $2, category_code = $3, status = $4, edited_on = clock_timestamp(), edited_by = $5, category_oid = $6 where oid = $7`,
                  values: [payload.name, payload.description, payload.category_code, payload.status, user_id, payload.category_oid, payload.oid]
            }
            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while updating sub category : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Sub Category ${payload.email} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Sub Category Updated Successfully!",
      });
}

module.exports = update_sub_category_details