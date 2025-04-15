const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_category_list = async (request, res) => {
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
            log.info(`Category list Found: ${data?.length} of ${total}`);
            return res.status(200).json({
                  code: 200,
                  message: "Category list Found",
                  total,
                  data: [],
            });
      } catch (e) {
            log.error(`An exception occurred while getting category information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_count_sql = (request) => {
      let query = `SELECT COUNT(*) AS total FROM ${TABLE.CATEGORIES} WHERE 1 = 1`;
      let values = [];

      if (request.query.search_text) {
            const searchText = `%${request.query.search_text.toLowerCase()}%`;
            query += ` AND (LOWER(name) LIKE $${values.length + 1} `;
            query += `OR LOWER(category_code) LIKE $${values.length + 2})`;
            values.push(searchText, searchText);
      }

      if (request.query.status) {
            query += `AND status = $${values.length + 1}`
            values.push(request.query.status);
      }

      return { text: query, values };
};

const generate_data_sql = (request) => {
      let query = `SELECT 
  c.oid,
  c.name,
  c.description,
  c.status,
  c.category_code,
  COALESCE(
    JSON_AGG(
      JSONB_BUILD_OBJECT(
        'oid', sc.oid,
        'name', sc.name,
        'description', sc.description,
        'category_code', sc.category_code,
        'status', sc.status,
        'created_by', sc.created_by,
        'created_on', sc.created_on,
        'edited_by', sc.edited_by,
        'edited_on', sc.edited_on
      )
    ) FILTER (WHERE sc.oid IS NOT NULL),
    '[]'
  ) AS children
FROM 
  categories c
LEFT JOIN 
  sub_categories sc ON c.oid = sc.category_oid
GROUP BY 
  c.oid, c.name, c.description, c.status, c.category_code`;
      let values = [];

      /* if (request.query.search_text) {
            const searchText = `%${request.query.search_text.toLowerCase()}%`;
            query += ` AND (LOWER(c.name) LIKE $${values.length + 1} `;
            query += `OR LOWER(c.category_code) LIKE $${values.length + 2})`;
            values.push(searchText, searchText);
      }

      if (request.query.status) {
            query += ` AND c.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      query += ` ORDER BY c.created_on ASC`

      if (request.query.offset) {
            query += ` OFFSET $${values.length + 1}`;
            values.push(Number(request.query.offset));
      }

      if (request.query.limit) {
            query += ` FETCH NEXT $${values.length + 1} ROWS ONLY`;
            values.push(Number(request.query.limit));
      } */

      return { text: query, values };
};

module.exports = get_category_list;
