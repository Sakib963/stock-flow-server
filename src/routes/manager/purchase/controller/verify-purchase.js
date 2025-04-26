const { TABLE } = require("../../../../utils/constant");
const { execute_values } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const verify_purchase = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const purchase_sql = {
                  text: `UPDATE ${TABLE.PURCHASE} SET status = $1, verified_on = clock_timestamp(), verified_by = $2, edited_on = clock_timestamp(), edited_by = $2 WHERE oid = $3`,
                  values: ['Verified', user_id, payload.oid]
            }
            const purchase_details_sql = []
            payload.products.map((product) => {
                  let details_sql = {
                        text: `UPDATE ${TABLE.PURCHASE_DETAILS} SET verified_quantity = $1, verified_unit_price = $2 WHERE oid = $3 AND purchase_oid = $4`,
                        values: [product.verified_quantity, product.verified_unit_price, product.oid, payload.oid]
                  }
                  purchase_details_sql.push(details_sql);
            })
            await execute_values([purchase_sql, ...purchase_details_sql]);
      } catch (e) {
            log.error(`An exception occurred while verifying purchase order : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Purchase order ${payload.oid} verified successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Purchase order verified Successfully!",
      });
}

module.exports = verify_purchase