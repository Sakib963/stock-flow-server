const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_sub_category_list = async (request, res) => {
      try {
            // Step 1: Generate SQL for total count
            const countSql = generate_count_sql(request);

            const countResult = await get_data(countSql);
            const total = countResult[0]?.total || 0;

            // Step 2: Generate SQL for paginated data
            const dataSql = generate_data_sql(request);

            const data_set = await get_data(dataSql);
            const data = data_set.length ? data_set : [];

            // Step 3: Respond with total count and paginated data
            log.info(`Sub-Category list Found: ${data?.length} of ${total}`);
            return res.status(200).json({
                  code: 200,
                  message: "Sub-Category list Found",
                  total,
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting sub-category information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_count_sql = (request) => {
      let query = `SELECT COUNT(*) AS total FROM ${TABLE.SUB_CATEGORIES} sc LEFT JOIN ${TABLE.CATEGORIES} c ON sc.category_oid = c.oid WHERE 1 = 1`;
      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            query += ` AND (LOWER(sc.name) LIKE $${values.length + 1} `;
            query += `OR LOWER(sc.category_code) LIKE $${values.length + 2})`;
            values.push(searchText, searchText);
      }

      if (request.query.status && request.query.status.trim() !== "" && request.query.status !== 'null') {
            query += ` AND sc.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      if (request.query.category_oid && request.query.category_oid.trim() !== "" && request.query.category_oid !== 'null') {
            query += ` AND sc.category_oid = $${values.length + 1}`;
            values.push(request.query.category_oid);
      }

      return { text: query, values };
};

const generate_data_sql = (request) => {
      let query = `SELECT sc.oid, sc.name, sc.description, sc.status, sc.category_code, c.name as category_name FROM ${TABLE.SUB_CATEGORIES} sc LEFT JOIN ${TABLE.CATEGORIES} c ON sc.category_oid = c.oid WHERE 1 = 1`;
      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            query += ` AND (LOWER(sc.name) LIKE $${values.length + 1} `;
            query += `OR LOWER(sc.category_code) LIKE $${values.length + 2})`;
            values.push(searchText, searchText);
      }

      if (request.query.status && request.query.status.trim() !== "" && request.query.status !== 'null') {
            query += ` AND sc.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      if (request.query.category_oid && request.query.category_oid.trim() !== "" && request.query.category_oid !== 'null') {
            query += ` AND sc.category_oid = $${values.length + 1}`;
            values.push(request.query.category_oid);
      }

      query += ` ORDER BY sc.created_on ASC`
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

module.exports = get_sub_category_list;
