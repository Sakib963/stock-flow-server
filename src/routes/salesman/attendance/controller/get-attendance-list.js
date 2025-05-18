const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_attendance_list = async (request, res) => {
      try {
            let user_id = request.credentials.user_id;
            // Step 1: Generate SQL for total count
            const countSql = generate_count_sql(request);

            const countResult = await get_data(countSql);
            const total = countResult[0]?.total || 0;

            // Step 2: Generate SQL for paginated data
            const dataSql = generate_data_sql(request);

            const data_set = await get_data(dataSql);
            const data = data_set.length ? data_set : [];

            // Step 3: Respond with total count and paginated data
            log.info(`Attendance list Found: ${data?.length} of ${total}`);
            return res.status(200).json({
                  code: 200,
                  message: "Attendance list Found",
                  total,
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting Attendance information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_count_sql = (request) => {
      let query = `SELECT COUNT(*) AS total FROM ${TABLE.ATTENDANCE} WHERE created_by = $1`;
      let values = [request.credentials.user_id];

      if (request.query.month) {
            query += ` AND TO_CHAR(attendance_date, 'YYYY-MM') = $${values.length + 1}`;
            values.push(request.query.month);
      }

      return { text: query, values };
};

const generate_data_sql = (request) => {
      let query = `SELECT a.oid, a.attendance_date, to_char(a.attendance_date, 'DD/MM/YYYY') as parsed_attendance_date, a.sign_in_time, a.sign_in_location, a.sign_out_time, a.sign_out_location, a.created_by, a.created_on, a.edited_by, a.edited_on, a.sign_in_time AS sign_in_time_bd, a.sign_out_time AS sign_out_time_bd, l.name as employee_name FROM ${TABLE.ATTENDANCE} a LEFT JOIN ${TABLE.LOGIN} l ON l.email = a.created_by WHERE 1 = 1 AND a.created_by = $1`;
      let values = [request.credentials.user_id];

      if (request.query.month) {
            query += ` AND TO_CHAR(attendance_date, 'YYYY-MM') = $${values.length + 1}`;
            values.push(request.query.month);
      }

      query += ` ORDER BY a.attendance_date DESC`

      if (request.query.offset) {
            query += ` OFFSET $${values.length + 1}`;
            values.push(Number(request.query.offset));
      }

      if (request.query.limit) {
            query += ` FETCH NEXT $${values.length + 1} ROWS ONLY`;
            values.push(Number(request.query.limit));
      }

      return { text: query, values };
};

module.exports = get_attendance_list;
