const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_return_details = async (request, res) => {
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
      const return_oid = request.query.oid;

      const sql = {
            text: `SELECT
                        pr.oid,
                        pr.sales_oid,
                        pr.invoice_no,
                        pr.refund_amount,
                        pr.return_reason,
                        pr.status,
                        to_char(pr.created_on, 'DD/MM/YYYY') as created_on,
                        pr.created_by,
                        CAST(s.total_amount AS INTEGER) as sales_total,
                        s.customer_name,
                        s.customer_phone,
                        to_char(s.created_on, 'DD/MM/YYYY') as sales_date,
                        s.created_by as sold_by,
                        json_agg(
                        json_build_object(
                              'oid', rd.oid,
                              'return_oid', rd.return_oid,
                              'inventory_oid', rd.inventory_oid,
                              'product_oid', rd.product_oid,
                              'product_name', pd.name,
                              'return_quantity', CAST(rd.return_quantity AS INTEGER),
                              'batch_code', inv.batch_code,
                              'supplier', sup.name,
                              'supplier_oid', sup.oid
                        )
                        ) AS products
                  FROM ${TABLE.PRODUCT_RETURN} pr
                  LEFT JOIN ${TABLE.SALES} s ON s.oid = pr.sales_oid
                  LEFT JOIN ${TABLE.RETURN_DETAILS} rd ON rd.return_oid = pr.oid
                  LEFT JOIN ${TABLE.PRODUCT} pd ON pd.oid = rd.product_oid
                  LEFT JOIN ${TABLE.INVENTORY} inv ON inv.oid = rd.inventory_oid
                  LEFT JOIN ${TABLE.PURCHASE_DETAILS} prd ON prd.oid = inv.purchase_details_oid
                  LEFT JOIN ${TABLE.PURCHASE} pur ON pur.oid = prd.purchase_oid
                  LEFT JOIN ${TABLE.SUPPLIER} sup ON sup.oid = pur.supplier_oid
                  WHERE pr.oid = $1
                  GROUP BY pr.oid, pr.sales_oid, pr.invoice_no, pr.refund_amount, pr.return_reason, pr.status, pr.created_on, pr.created_by,
                           s.total_amount, s.customer_name, s.customer_phone, s.created_on, s.created_by`,
            values: [return_oid]
      };

      return sql;
};


module.exports = get_product_return_details;
