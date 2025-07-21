const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_invoice_list = async (request, res) => {
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
            log.info(`Invoice list Found: ${data?.length} of ${total}`);
            return res.status(200).json({
                  code: 200,
                  message: "Invoice list Found",
                  total,
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting Invoice information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_count_sql = (request) => {
      let query = `SELECT COUNT(*) AS total FROM ${TABLE.SALES} s WHERE s.created_by = $1`;
      let values = [request.credentials.user_id];

      if (request.query.status) {
            query += ` AND s.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      if (request.query.selected_date && request.query.selected_date !== "null") {
            const selectedDate = new Date(request.query.selected_date);
            query += ` AND s.created_on::date = $${values.length + 1}`;
            values.push(selectedDate.toISOString().split("T")[0]);
      }

      return { text: query, values };
};


const generate_data_sql = (request) => {
      let query = `
    SELECT s.oid, s.invoice_no, s.customer_name, s.customer_phone, s.total_amount, s.status, s.notes, s.created_by, s.created_on, s.edited_on, s.edited_by, COUNT(sd.oid) AS product_count
    FROM ${TABLE.SALES} s
    LEFT JOIN ${TABLE.SALE_DETAILS} sd ON sd.sales_oid = s.oid
    WHERE s.created_by = $1
  `;
      let values = [request.credentials.user_id];

      if (request.query.status) {
            query += ` AND s.status = $${values.length + 1}`;
            values.push(request.query.status);
      }

      if (request.query.selected_date && request.query.selected_date !== "null") {
            const selectedDate = new Date(request.query.selected_date);
            query += ` AND s.created_on::date = $${values.length + 1}`;
            values.push(selectedDate.toISOString().split("T")[0]);
      }

      query += `
    GROUP BY 
      s.oid, s.invoice_no, s.customer_name, s.customer_phone, 
      s.total_amount, s.status, s.notes, s.created_by, 
      s.created_on, s.edited_on, s.edited_by
    ORDER BY s.created_on DESC
  `;

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


module.exports = get_invoice_list;
