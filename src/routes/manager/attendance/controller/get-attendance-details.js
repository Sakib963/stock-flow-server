const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_attendance_details = async (request, res) => {
      try {
            // Step 1: Generate SQL for paginated data
            const dataSql = generate_data_sql(request);

            const data_set = await get_data(dataSql);
            const data = data_set.length ? data_set[0] : null;

            // Step 2: Respond with data
            log.info(`Attendance details Found for oid: ${request.query.oid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Attendance details Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting Attendance details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_data_sql = (request) => {
      let query = `SELECT a.oid,  a.attendance_date,  a.sign_in_time, a.sign_in_location, a.sign_out_time, a.sign_out_location, a.created_by, a.created_on, a.edited_by, a.edited_on, to_char(a.attendance_date, 'DD/MM/YYYY') as parsed_attendance_date, l.name as employee_name FROM ${TABLE.ATTENDANCE} a LEFT JOIN ${TABLE.LOGIN} l ON l.email = a.created_by WHERE a.oid = $1`;
      let values = [request.query.oid];

      return { text: query, values };
};

module.exports = get_attendance_details;
