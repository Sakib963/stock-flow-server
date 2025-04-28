const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_price_fixation_product_list = async (request, res) => {
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
            log.info(`Inventory overview list Found: ${data?.length} of ${total}`);
            return res.status(200).json({
                  code: 200,
                  message: "Inventory overview list Found",
                  total,
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting Inventory overview information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_count_sql = (request) => {
      let query = `
        SELECT COUNT(DISTINCT p.oid) AS total
        FROM ${TABLE.PRODUCT} p
        LEFT JOIN ${TABLE.INVENTORY} i ON i.product_oid = p.oid
        WHERE p.status = 'Active'
          AND i.quantity_available > 0
      `;
      let values = [];

      if (request.query.search_text) {
            const searchText = `%${request.query.search_text.toLowerCase()}%`;
            query += ` AND LOWER(p.name) LIKE $${values.length + 1}`;
            values.push(searchText);
      }

      if (request.query.status) {
            query += ` AND p.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      return { text: query, values };
};


const generate_data_sql = (request) => {
      let query = `
        SELECT i.oid AS inventory_oid, i.product_oid, p.name AS product_name,
          SUM(i.quantity_available) OVER (PARTITION BY i.product_oid) AS total_quantity_available,
          COUNT(i.oid) OVER (PARTITION BY i.product_oid) AS total_batches,
          p.photo
        FROM ${TABLE.INVENTORY} i
        LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
        WHERE p.status = 'Active' AND i.quantity_available > 0
      `;
      let values = [];

      if (request.query.search_text) {
            const searchText = `%${request.query.search_text.toLowerCase()}%`;
            query += ` AND LOWER(p.name) LIKE $${values.length + 1}`;
            values.push(searchText);
      }

      if (request.query.status) {
            query += ` AND p.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      query += ` ORDER BY p.name ASC`;

      if (request.query.limit) {
            query += ` LIMIT $${values.length + 1}`;
            values.push(Number(request.query.limit));
      }

      if (request.query.offset) {
            query += ` OFFSET $${values.length + 1}`;
            values.push(Number(request.query.offset));
      }

      return { text: query, values };
};


module.exports = get_price_fixation_product_list;
