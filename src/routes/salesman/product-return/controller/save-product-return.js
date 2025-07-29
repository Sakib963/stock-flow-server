const { TABLE } = require("../../../../utils/constant");
const { execute_values } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');

const save_product_return = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const sql_array = generate_sql(payload, user_id)
            await execute_values(sql_array);
      } catch (e) {
            log.error(`An exception occurred while saving product return : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
      log.info(`Product return for invoice ${payload.invoice_no} saved successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Product Return Saved Successfully!",
      });
}

const generate_sql = (payload, user_id) => {
      const sql_array = [];
      const return_oid = uuidv4();

      const return_sql = {
            text: `INSERT INTO ${TABLE.PRODUCT_RETURN} (oid, sales_oid, invoice_no, refund_amount, return_reason, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            values: [return_oid, payload.invoice_oid, payload.invoice_no, payload.refund_amount, payload.return_reason, "Returned", user_id]
      }
      sql_array.push(return_sql);

      payload.products.forEach(product => {
            const return_details_sql = {
                  text: `INSERT INTO ${TABLE.RETURN_DETAILS} (oid, return_oid, product_oid, inventory_oid, return_quantity) VALUES ($1, $2, $3, $4, $5)`,
                  values: [uuidv4(), return_oid, product.product_oid, product.inventory_oid, product.return_quantity]
            }
            sql_array.push(return_details_sql);

            const inventory_sql = {
                  text: `UPDATE ${TABLE.INVENTORY} SET quantity_available = quantity_available + $1 WHERE oid = $2`,
                  values: [product.return_quantity, product.inventory_oid]
            }
            sql_array.push(inventory_sql);

            const product_stat_sql = {
                  text: `UPDATE ${TABLE.PRODUCT_STATS} SET total_returned = total_returned + $1 WHERE product_oid = $2`,
                  values: [product.return_quantity, product.product_oid]
            }
            sql_array.push(product_stat_sql);
      });

      const sales_sql = {
            text: `UPDATE ${TABLE.SALES} SET status = $1, edited_on = clock_timestamp(), edited_by = $2 WHERE oid = $3`,
            values: ["Returned", user_id, payload.invoice_oid]
      }
      sql_array.push(sales_sql);
      return sql_array;
}

module.exports = save_product_return;