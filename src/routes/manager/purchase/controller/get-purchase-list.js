const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_purchase_list = async (request, res) => {
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
            log.info(`Purchase Order list Found: ${data?.length} of ${total}`);
            return res.status(200).json({
                  code: 200,
                  message: "Purchase Order list Found",
                  total,
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting Purchase Order information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_count_sql = (request) => {
      let query = `SELECT COUNT(DISTINCT p.oid) AS total FROM ${TABLE.PURCHASE} p LEFT JOIN ${TABLE.SUPPLIER} s ON p.supplier_oid = s.oid LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON p.oid = pd.purchase_oid LEFT JOIN ${TABLE.PRODUCT} pr ON pd.product_oid = pr.oid WHERE 1 = 1`;

      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            query += ` AND (LOWER(s.name) LIKE $${values.length + 1} OR LOWER(pr.name) LIKE $${values.length + 2})`;
            values.push(searchText, searchText);
      }

      if (request.query.status !== 'null' && request.query.status !== '') {
            query += ` AND p.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      return { text: query, values };
};

const generate_data_sql = (request) => {
      let query = `
        SELECT p.oid, p.total_amount, p.payment_status, p.paid_amount, p.purchase_type, p.status, s.name AS supplier_name, COUNT(pd.product_oid) AS product_count, to_char(p.created_on, 'DD/MM/YYYY') as created_on, p.created_by  
        FROM ${TABLE.PURCHASE} p LEFT JOIN ${TABLE.SUPPLIER} s ON p.supplier_oid = s.oid LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON p.oid = pd.purchase_oid LEFT JOIN ${TABLE.PRODUCT} pr ON pd.product_oid = pr.oid WHERE 1 = 1`;

      let values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`; // fixed space
            query += ` AND (LOWER(s.name) LIKE $${values.length + 1} OR LOWER(pr.name) LIKE $${values.length + 2})`;
            values.push(searchText, searchText);
      }

      if (request.query.status !== 'null' && request.query.status !== '') {
            query += ` AND p.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      query += ` GROUP BY p.oid, p.total_amount, p.payment_status, p.paid_amount, p.purchase_type, p.status, s.name, p.created_on`;

      query += ` ORDER BY p.created_on DESC`;

      if (request.query.offset !== undefined) { // also safe checking
            query += ` OFFSET $${values.length + 1}`;
            values.push(Number(request.query.offset));
      }

      if (request.query.limit !== undefined) {
            query += ` FETCH NEXT $${values.length + 1} ROWS ONLY`;
            values.push(Number(request.query.limit));
      }

      return { text: query, values };
};

module.exports = get_purchase_list;
