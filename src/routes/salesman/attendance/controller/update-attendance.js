const { TABLE } = require("../../../../utils/constant");
const { execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');

const update_attendance = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            let sql;
            // Convert UTC time from client to Bangladesh Time (UTC+6)
            const utcDate = new Date(payload.attendance_time);
            const bangladeshTime = new Date(utcDate.getTime() + (6 * 60 * 60 * 1000)); // UTC + 6 hours

            if (payload.action === 'Sign In') {
                  sql = {
                        text: `INSERT INTO ${TABLE.ATTENDANCE} 
               (oid, attendance_date, sign_in_time, sign_in_location, created_by) 
               VALUES ($1, $2, $3, $4, $5)`,
                        values: [
                              uuidv4(),
                              bangladeshTime.toISOString().split("T")[0], // Only date part (YYYY-MM-DD)
                              bangladeshTime.toISOString(), // Full datetime in ISO (BST)
                              payload.attendance_location,
                              user_id,
                        ]
                  };
            } else {
                  sql = {
                        text: `UPDATE ${TABLE.ATTENDANCE} 
               SET sign_out_time = $1, sign_out_location = $2, edited_on = clock_timestamp(), edited_by = $3 
               WHERE oid = $4`,
                        values: [
                              bangladeshTime.toISOString(),
                              payload.attendance_location,
                              user_id,
                              payload.oid
                        ]
                  };
            }
            await execute_value(sql)
      } catch (e) {
            log.error(`An exception occurred while updating Attendance : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
      log.info(`Attendance ${payload.email} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Attendance Updated Successfully!",
      });
}

module.exports = update_attendance