const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_invoice_number = async (request, res) => {
      try {
            // Step 1: Generate SQL for data
            const countSql = generate_count_sql(request);

            const result = await get_data(countSql);
            const todayCount = result?.[0]?.today_sales_count ?? 0;
            // Log and respond
            log.info(`Today's Sales Count: ${todayCount}`);

            const invoiceNumber = construct_invoice_number(todayCount);

            // Step 2: Respond with data
            log.info(`Generated Invoice Number: ${invoiceNumber}`);
            return res.status(200).json({
                  code: 200,
                  message: "Invoice Number Found",
                  data: {
                        invoice_no: invoiceNumber
                  },
            });
      } catch (e) {
            log.error(`An exception occurred while generating Invoice Number: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const construct_invoice_number = (count) => {
      const now = new Date();
      const year = String(now.getFullYear()).slice(-2);         // e.g. '25'
      const month = String(now.getMonth() + 1).padStart(2, '0'); // e.g. '05'
      const day = String(now.getDate()).padStart(2, '0');        // e.g. '27'
      const sequence = String(count + 1).padStart(4, '0');       // e.g. '0003'

      return `${year}${month}${day}${sequence}`; // Result: '2505270003'
};

const generate_count_sql = (request) => {
      const sql = {
            text: `SELECT COUNT(*)::int AS today_sales_count FROM ${TABLE.SALES} WHERE created_on::date = CURRENT_DATE`,
            values: []
      }

      return sql;
};

module.exports = get_invoice_number;
