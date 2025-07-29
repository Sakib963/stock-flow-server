const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_list = async (request, res) => {
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
            log.info(`Product list Found: ${data?.length} of ${total}`);
            return res.status(200).json({
                  code: 200,
                  message: "Product list Found",
                  total,
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting product information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_count_sql = (request) => {
      let query = `SELECT COUNT(*) AS total FROM ${TABLE.PRODUCT} WHERE 1 = 1`;
      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            query += ` AND (LOWER(name) LIKE $${values.length + 1} `;
            query += `OR LOWER(sku) LIKE $${values.length + 2})`;
            values.push(searchText, searchText);
      }

      if (request.query.status) {
            query += `AND status = $${values.length + 1}`
            values.push(request.query.status);
      }

      return { text: query, values };
};

const generate_data_sql = (request) => {
      let query = `SELECT p.oid, p.name, p.status, p.category_oid, p.sub_category_oid, p.sku, p.photo, c.name as category_name, s.name as source_name FROM ${TABLE.PRODUCT} p LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid LEFT JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid WHERE 1 = 1`;
      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            query += ` AND (LOWER(p.name) LIKE $${values.length + 1} `;
            query += `OR LOWER(p.sku) LIKE $${values.length + 2})`;
            values.push(searchText, searchText);
      }

      if (request.query.status) {
            query += ` AND p.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      query += ` ORDER BY p.created_on ASC`

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

module.exports = get_product_list;
