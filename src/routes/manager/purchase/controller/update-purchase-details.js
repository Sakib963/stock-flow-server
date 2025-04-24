const { TABLE } = require("../../../../utils/constant");
const { execute_values } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const update_purchase_details = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const purchase_sql = {
                  text: `UPDATE ${TABLE.PURCHASE} SET supplier_oid = $1, total_amount = $2, special_notes = $3, payment_status = $4, paid_amount = $5, purchase_type = $6, status = $7, edited_on = clock_timestamp(), edited_by = $8 WHERE oid = $9`,
                  values: [payload.supplier_oid, payload.total_amount, payload.special_notes, payload.payment_status, payload.paid_amount, payload.purchase_type, 'Submitted', user_id, payload.oid]
            }
            const purchase_details_sql = []
            payload.products.map((product) => {
                  let details_sql = {
                        text: `UPDATE ${TABLE.PURCHASE_DETAILS} SET product_oid = $1, warehouse_oid = $2, aisle_oid = $3, ordered_quantity = $4, ordered_unit_price = $5 WHERE oid = $6 AND purchase_oid = $7`,
                        values: [product.product_oid, product.warehouse_oid, product.aisle_oid, product.quantity, product.unit_price, product.oid, payload.oid]
                  }
                  purchase_details_sql.push(details_sql);
            })
            await execute_values([purchase_sql, ...purchase_details_sql]);
      } catch (e) {
            log.error(`An exception occurred while updating purchase order : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Purchase order ${payload.oid} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Purchase order Updated Successfully!",
      });
}

module.exports = update_purchase_details