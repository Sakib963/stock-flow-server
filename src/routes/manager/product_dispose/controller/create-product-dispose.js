const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value, execute_values } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');

const create_product_dispose = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const disposal_sql = {
                  text: `INSERT INTO ${TABLE.PRODUCT_DISPOSE} (oid, product_oid, inventory_oid, dispose_quantity, reason, notes, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                  values: [uuidv4(), payload.product_oid, payload.inventory_oid, payload.dispose_quantity, payload.reason, payload.notes, 'Approved', user_id]
            }

            const inventory_sql = {
                  text: `UPDATE ${TABLE.INVENTORY} SET quantity_available = quantity_available - $1 WHERE oid = $2`,
                  values: [payload.dispose_quantity, payload.inventory_oid]
            }

            await execute_values([disposal_sql, inventory_sql]);
      } catch (e) {
            log.error(`An exception occurred while creating product dispose : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Product ${payload.product_oid} disposal created successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Product Dispose Created Successfully!",
      });
}

module.exports = create_product_dispose