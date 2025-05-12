const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const check_current_attendance_status = async (request, res) => {
      try {
            let data = [];
            // Step 1: Set user ID
            const user_id = request.credentials.user_id; // Default to today's date if not provided
            const sql = generate_data_sql(request)
            const data_set = await get_data(sql);
            data = data_set[0]
            // Step 2: Respond with total count and paginated data
            log.info(`Attendance Status Found For user: ${user_id}`);
            return res.status(200).json({
                  code: 200,
                  message: "Attendance Status Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting Attendance information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_data_sql = (request) => {
      const user_id = request.credentials.user_id;
      const query_date = request.query.date ? request.query.date : new Date().toISOString().split('T')[0];
      let query = `SELECT 
                        a.oid, 
                        a.attendance_date, 
                        a.sign_in_time, 
                        a.sign_out_time, 
                        a.sign_in_location, 
                        a.sign_out_location
                  FROM ${TABLE.ATTENDANCE} a 
                  WHERE a.created_by = $1 AND a.attendance_date = $2
                  LIMIT 1`;
      let values = [user_id, query_date];
      return { text: query, values };
};

module.exports = check_current_attendance_status;
