const { TABLE } = require("../../../../utils/constant");
const { execute_values, get_data } = require("../../../../utils/database");
const { generate_batch_code } = require("../../../../utils/generate-batch-code");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');

const verify_purchase = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const purchase_sql = {
                  text: `UPDATE ${TABLE.PURCHASE} SET status = $1, verified_on = clock_timestamp(), verified_by = $2, edited_on = clock_timestamp(), edited_by = $2 WHERE oid = $3`,
                  values: ['Verified', user_id, payload.oid]
            }

            let batch_code;
            let is_unique = false;
            while (!is_unique) {
                  batch_code = generate_batch_code();
                  is_unique = await check_unique_batch_code(batch_code);
            }

            const purchase_details_sql = []
            const inventory_insert_sql = []
            payload.products.map((product) => {
                  let details_sql = {
                        text: `UPDATE ${TABLE.PURCHASE_DETAILS} SET verified_quantity = $1, verified_unit_price = $2 WHERE oid = $3 AND purchase_oid = $4`,
                        values: [product.verified_quantity, product.verified_unit_price, product.oid, payload.oid]
                  }
                  purchase_details_sql.push(details_sql);

                  let status = 'internal_use';
                  if (product.intended_use === 'for_sale' && product.selling_price) {
                        status = 'ready_for_sale'
                  } else if (product.intended_use === 'for_sale' && !product.selling_price) {
                        status = 'pending_pricing'
                  }
                  // Insert into inventory
                  let inventory_sql = {
                        text: `INSERT INTO ${TABLE.INVENTORY} (oid, batch_code, product_oid, purchase_details_oid, initial_quantity, quantity_available, cost_price, intended_use, status, created_by, selling_price, maximum_discount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                        values: [uuidv4(), batch_code, product.product_oid, product.oid, product.verified_quantity, product.verified_quantity, product.verified_unit_price, product.intended_use, status, user_id, product.selling_price, product.maximum_discount
                        ]
                  }
                  inventory_insert_sql.push(inventory_sql)

            })
            await execute_values([purchase_sql, ...purchase_details_sql, ...inventory_insert_sql]);
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

const check_unique_batch_code = async (batch_code) => {
      const sql = {
            text: `SELECT COUNT(oid)::int4 as total FROM ${TABLE.INVENTORY} WHERE batch_code = $1`,
            values: [batch_code]
      }
      try {
            let data_set = await get_data(sql);
            return data_set[0]["total"] === 0;
      } catch (e) {
            log.error(`An exception occurred while checking batch code uniqueness: ${e?.message}`);
            throw new Error(e);
      }
}

module.exports = verify_purchase