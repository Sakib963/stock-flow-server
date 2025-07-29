const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_user_list = async (request, res) => {
      try {
            // Step 1: Generate SQL for total count
            const countSql = generate_count_sql(request);

            const countResult = await get_data(countSql);
            const total = countResult[0]?.total || 0;

            // Step 2: Generate SQL for paginated data
            const dataSql = generate_data_sql(request);

            const data_set = await get_data(dataSql);
            const data = data_set.length ? data_set : null;

            // Step 3: Respond with total count and paginated data
            log.info(`User list Found: ${data?.length} of ${total}`);
            return res.status(200).json({
                  code: 200,
                  message: "User list Found",
                  total,
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting user information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_count_sql = (request) => {
      let query = `SELECT COUNT(*) AS total FROM ${TABLE.LOGIN} WHERE 1 = 1 `;
      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim()}%`;
            query += ` AND (LOWER(name) LIKE $${values.length + 1} `;
            query += `OR LOWER(email) LIKE $${values.length + 2} `;
            query += `OR LOWER(designation) LIKE $${values.length + 3}) `;
            values.push(searchText, searchText, searchText);
      }

      return { text: query, values };
};

const generate_data_sql = (request) => {
      let query = `SELECT oid, name, email, status, designation, photo FROM ${TABLE.LOGIN} WHERE 1 = 1 `;
      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim()}%`;
            query += ` AND (LOWER(name) LIKE $${values.length + 1} `;
            query += `OR LOWER(email) LIKE $${values.length + 2} `;
            query += `OR LOWER(designation) LIKE $${values.length + 3}) `;
            values.push(searchText, searchText, searchText);
      }

      if (request.query.offset) {
            query += ` OFFSET $${values.length + 1}`;
            values.push(request.query.offset);
      }

      if (request.query.limit) {
            query += ` FETCH NEXT $${values.length + 1} ROWS ONLY`;
            values.push(request.query.limit);
      }

      return { text: query, values };
};

module.exports = get_user_list;
