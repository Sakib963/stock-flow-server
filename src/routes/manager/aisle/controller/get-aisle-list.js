const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_aisle_list = async (request, res) => {
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
            log.info(`Aisle list Found: ${data?.length} of ${total}`);
            return res.status(200).json({
                  code: 200,
                  message: "Aisle list Found",
                  total,
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting aisle information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_count_sql = (request) => {
      let query = `SELECT COUNT(*) AS total FROM ${TABLE.AISLE} WHERE 1 = 1`;
      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            query += ` AND (LOWER(name) LIKE $${values.length + 1} `;
            query += `OR LOWER(code) LIKE $${values.length + 2})`;
            values.push(searchText, searchText);
      }

      if (request.query.status) {
            query += `AND status = $${values.length + 1}`
            values.push(request.query.status);
      }

      return { text: query, values };
};

const generate_data_sql = (request) => {
      let query = `SELECT a.oid, a.name, a.code, a.warehouse_oid, a.capacity, a.type_of_storage, a.special_notes, a.status, w.name as warehouse_name FROM ${TABLE.AISLE} a LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = a.warehouse_oid WHERE 1 = 1`;
      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            query += ` AND (LOWER(a.name) LIKE $${values.length + 1} `;
            query += `OR LOWER(a.code) LIKE $${values.length + 2})`;
            values.push(searchText, searchText);
      }

      if (request.query.status) {
            query += ` AND a.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      query += ` ORDER BY a.created_on ASC`

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

module.exports = get_aisle_list;
