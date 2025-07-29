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
// ----------- get list by product -------------
/* const generate_count_sql = (request) => {
      let query = `SELECT COUNT(distinct p.oid) AS total from ${TABLE.PRODUCT} p left join ${TABLE.INVENTORY} bd ON bd.product_oid = p.oid WHERE p.status = 'Active'`;
      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            query += ` AND (
                  LOWER(p.name) LIKE $${values.length + 1} 
                  OR LOWER(bd.batch_code) LIKE $${values.length + 2}
            )`;
            values.push(searchText, searchText);
      }

      if (request.query.status) {
            query += ` AND p.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      return { text: query, values };
};

const generate_data_sql = (request) => {
      let query = `select p.oid as product_oid, p.name as product_name, p.restock_threshold, p.photo, COALESCE(COUNT(DISTINCT bd.batch_code), 0) AS total_batches, COALESCE(SUM(bd.quantity_available)::INTEGER, 0) AS total_available_quantity from ${TABLE.PRODUCT} p left join ${TABLE.INVENTORY} bd ON bd.product_oid = p.oid  WHERE p.status = 'Active'`;

      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            query += ` AND (
                  LOWER(p.name) LIKE $${values.length + 1} 
                  OR LOWER(bd.batch_code) LIKE $${values.length + 2}
            )`;
            values.push(searchText, searchText);
      }

      if (request.query.status) {
            query += ` AND p.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      query += ` GROUP BY p.oid, p.name, p.restock_threshold, p.photo, p.status ORDER BY total_available_quantity DESC`;

      if (request.query.limit) {
            query += ` LIMIT $${values.length + 1}`;
            values.push(Number(request.query.limit));
      }

      if (request.query.offset) {
            query += ` OFFSET $${values.length + 1}`;
            values.push(Number(request.query.offset));
      }

      return { text: query, values };
}; */

const generate_count_sql = (request) => {
      let query = `SELECT COUNT(distinct p.oid) AS total 
                   FROM ${TABLE.PRODUCT} p 
                   INNER JOIN ${TABLE.INVENTORY} bd ON bd.product_oid = p.oid 
                   WHERE p.status = 'Active'`;
      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            query += ` AND (
                  LOWER(p.name) LIKE $${values.length + 1} 
                  OR LOWER(bd.batch_code) LIKE $${values.length + 2}
            )`;
            values.push(searchText, searchText);
      }

      if (request.query.status) {
            query += ` AND p.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      return { text: query, values };
};

const generate_data_sql = (request) => {
      let query = `SELECT 
                        p.oid AS product_oid,
                        p.name AS product_name,
                        p.restock_threshold,
                        p.photo,
                        COALESCE(COUNT(DISTINCT bd.batch_code), 0) AS total_batches,
                        COALESCE(SUM(bd.quantity_available)::INTEGER, 0) AS total_available_quantity,
                        bool_or(bd.status = 'pending_pricing') AS has_pending_pricing,
                        BOOL_OR(bd.intended_use = 'for_sale') AS has_for_sale_batch
                   FROM ${TABLE.PRODUCT} p 
                   INNER JOIN ${TABLE.INVENTORY} bd ON bd.product_oid = p.oid  
                   WHERE p.status = 'Active'`;

      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            query += ` AND (
                  LOWER(p.name) LIKE $${values.length + 1} 
                  OR LOWER(bd.batch_code) LIKE $${values.length + 2}
            )`;
            values.push(searchText, searchText);
      }

      if (request.query.status) {
            query += ` AND p.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      query += ` GROUP BY p.oid, p.name, p.restock_threshold, p.photo, p.status 
                 ORDER BY p.name ASC`;

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

module.exports = get_product_list;
