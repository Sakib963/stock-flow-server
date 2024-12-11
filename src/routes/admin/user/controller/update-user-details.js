const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const update_user_details = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const sql = {
                  text: `update ${TABLE.LOGIN} set name = $1, mobile_number = $2, role = $3, designation = $4, photo = $5, status = $6, edited_on = clock_timestamp(), edited_by = $7 where oid = $8`,
                  values: [payload.name, payload.mobile_number, payload.role, payload.designation, payload.photo, payload.status, user_id, payload.oid]
            }
            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while updating user : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`User ${payload.email} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "User Updated Successfully!",
      });
}

module.exports = update_user_details