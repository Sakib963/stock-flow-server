const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_sale_details = async (request, res) => {
      try {
            // Step 1: Generate SQL for data
            const sql = generate_data_sql(request);
            const data_set = await get_data(sql);
            const data = data_set.length ? data_set[0] : null;
            if (!data) {
                  log.info(`No Invoice found for OID: ${request.query.oid}`);
                  return res.status(404).json({ code: 404, message: "Invoice Not Found!" });
            }
            // Step 2: Respond with data
            log.info(`Invoice details Found for oid: ${data.oid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Invoice details Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting Invoice Details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_data_sql = (request) => {
      const invoice_oid = request.query.oid;

      const sql = {
            text: `SELECT
                        s.oid,
                        s.invoice_no,
                        s.customer_name,
                        s.customer_phone,
                        s.customer_address,
                        s.customer_email,
                        s.payment_method,
                        s.payment_reference,
                        s.payment_status,
                        s.notes,
                        s.status,
                        s.created_on,
                        CAST(s.total_amount AS INTEGER) AS total_amount,
                        json_agg(
                        json_build_object(
                              'inventory_oid', sd.inventory_oid,
                              'product_oid', sd.product_oid,
                              'product_name', sd.product_name,
                              'quantity_available', sd.available_stock,
                              'quantity', CAST(sd.quantity AS INTEGER),
                              'unit_price', CAST(sd.unit_price AS NUMERIC),
                              'discount', CAST(sd.discount AS NUMERIC),
                              'total', CAST(sd.total AS NUMERIC)
                        )
                        ) AS products
                  FROM ${TABLE.SALES} s
                  LEFT JOIN ${TABLE.SALE_DETAILS} sd ON s.oid = sd.sales_oid
                  WHERE s.oid = $1
                  GROUP BY s.oid`,
            values: [invoice_oid]
      };

      return sql;
};


module.exports = get_sale_details;
