const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value, execute_values } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { v4: uuidv4 } = require('uuid');

const create_product = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            // Check product
            const exiting_product = await check_existing_product(payload.sku)
            if (exiting_product) {
                  log.warn(`SKU already exists [${payload.sku}]`);
                  return res.status(409).json({ code: 409, message: "SKU Already Exists!" });
            }

            const product_oid = uuidv4();
            const sql = {
                  text: `INSERT INTO ${TABLE.PRODUCT} (oid, name, sku, category_oid, sub_category_oid, unit_type, description, photo, product_nature, restock_threshold, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                  values: [product_oid, payload.name, payload.sku, payload.category_oid, payload.sub_category_oid, payload.unit_type, payload.description, payload.photo, payload.product_nature, payload.restock_threshold, payload.status, user_id]
            }

            const product_stat_sql = {
                  text: `INSERT INTO ${TABLE.PRODUCT_STATS} (oid, product_oid) VALUES ($1, $2)`,
                  values: [uuidv4(), product_oid]
            }

            await execute_values([sql, product_stat_sql]);
      } catch (e) {
            log.error(`An exception occurred while creating product : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Product ${payload.name} created successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Product Created Successfully!",
      });
}

const check_existing_product = async (sku) => {
      let count = 0;
      const sql = {
            text: `select count(oid)::int4 as total from ${TABLE.PRODUCT} where sku = $1`,
            values: [sku]
      }
      try {
            let data_set = await get_data(sql);
            count = data_set[0]["total"];
      } catch (e) {
            log.error(`An exception occurred while checking product count : ${e?.message}`);
            throw new Error(e);
      }
      return count;
}

module.exports = create_product