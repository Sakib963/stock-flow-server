const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_return_list = async (request, res) => {
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
            log.info(`Product Return list Found: ${data?.length} of ${total}`);
            return res.status(200).json({
                  code: 200,
                  message: "Product Return list Found",
                  total,
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting Product Return information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_count_sql = (request) => {
      let query = `SELECT COUNT(*) AS total FROM ${TABLE.PRODUCT_RETURN} pr
      LEFT JOIN ${TABLE.SALES} s ON s.oid = pr.sales_oid WHERE pr.created_by = $1`;
      let values = [request.credentials.user_id];

      if (request.query.status) {
            query += ` AND pr.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            query += ` AND (LOWER(s.customer_name) LIKE $${values.length + 1} `;
            query += `OR LOWER(s.customer_phone) LIKE $${values.length + 2} `;
            query += `OR LOWER(pr.invoice_no) LIKE $${values.length + 3}) `;
            values.push(searchText, searchText, searchText);
      }

      return { text: query, values };
};


const generate_data_sql = (request) => {
      let query = `SELECT pr.oid, pr.invoice_no, pr.refund_amount, pr.status, to_char(pr.created_on, 'DD/MM/YYYY') as created_on, s.customer_name, s.customer_phone, s.total_amount, to_char(s.created_on, 'DD/MM/YYYY') as sales_date, l.name as sold_by 
      FROM ${TABLE.PRODUCT_RETURN} pr 
      LEFT JOIN ${TABLE.SALES} s ON s.oid = pr.sales_oid
      LEFT JOIN ${TABLE.LOGIN} l ON l.email = s.created_by
      WHERE pr.created_by = $1`;
      let values = [request.credentials.user_id];

      if (request.query.status) {
            query += ` AND pr.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim()}%`;
            query += ` AND (LOWER(s.customer_name) LIKE $${values.length + 1} `;
            query += `OR LOWER(s.customer_phone) LIKE $${values.length + 2} `;
            query += `OR LOWER(pr.invoice_no) LIKE $${values.length + 3}) `;
            values.push(searchText, searchText, searchText);
      }

      if (request.query.offset) {
            query += ` OFFSET $${values.length + 1}`;
            values.push(Number(request.query.offset));
      }

      if (request.query.limit) {
            query += ` LIMIT $${values.length + 1}`;
            values.push(Number(request.query.limit));
      }

      return { text: query, values };
};


module.exports = get_product_return_list;
