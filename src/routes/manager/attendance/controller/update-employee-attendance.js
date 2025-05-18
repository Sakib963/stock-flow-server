const { TABLE } = require("../../../../utils/constant");
const { execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const update_employee_attendance = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const sign_in_time_utc_date = new Date(payload.sign_in_time);
            const bangladesh_sign_in_time = new Date(sign_in_time_utc_date.getTime() + (6 * 60 * 60 * 1000));
            const sign_out_time_utc_date = new Date(payload.sign_out_time);
            const bangladesh_sign_out_time = new Date(sign_out_time_utc_date.getTime() + (6 * 60 * 60 * 1000));
            let sql = {
                  text: `UPDATE ${TABLE.ATTENDANCE} 
               SET sign_in_time = $1, sign_in_location = $2, sign_out_time = $3, sign_out_location = $4, edited_on = clock_timestamp(), edited_by = $5 
               WHERE oid = $6`,
                  values: [
                        bangladesh_sign_in_time.toISOString(),
                        payload.sign_in_location,
                        bangladesh_sign_out_time.toISOString(),
                        payload.sign_out_location,
                        user_id,
                        payload.oid
                  ]
            };
            await execute_value(sql)
      } catch (e) {
            log.error(`An exception occurred while updating Attendance : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
      log.info(`Attendance ${payload.oid} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Attendance Updated Successfully!",
      });
}

module.exports = update_employee_attendance