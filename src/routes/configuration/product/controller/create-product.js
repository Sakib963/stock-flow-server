const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value, execute_values } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");
const { v4: uuidv4 } = require('uuid');

const create_product = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            // Check product
            const exiting_product = await check_existing_product(payload.name)
            if (exiting_product) {
                  log.warn(`Product name already exists [${payload.name}]`);
                  return res.status(409).json({ code: 409, message: "Product Name Already Exists!" });
            }

            // Get category_oid from sub_category_oid
            const category_oid = await get_category_oid_from_subcategory(payload.sub_category_oid);
            if (!category_oid) {
                  log.error(`Category not found for sub_category_oid: ${payload.sub_category_oid}`);
                  return res.status(400).json({ code: 400, message: "Invalid Sub-Category!" });
            }

            // Convert empty strings to null for optional fields
            const brand_oid = payload.brand_oid || null;
            const sku = payload.sku || null;
            const unit_type = payload.unit_type || null;
            const description = payload.description || null;
            const photo = payload.photo || null;

            const product_oid = uuidv4();
            const sql = {
                  text: `INSERT INTO ${TABLE.PRODUCT} (oid, name, sku, category_oid, sub_category_oid, unit_type, description, photo, product_nature, restock_threshold, status, created_by, brand_oid) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                  values: [product_oid, payload.name, sku, category_oid, payload.sub_category_oid, unit_type, description, photo, payload.product_nature, payload.restock_threshold, payload.status, user_id, brand_oid]
            }

            const product_stat_sql = {
                  text: `INSERT INTO ${TABLE.PRODUCT_STATS} (oid, product_oid) VALUES ($1, $2)`,
                  values: [uuidv4(), product_oid]
            }

            await execute_values([sql, product_stat_sql]);

            // Log activity (non-blocking - fire and forget)
            saveLogActivity({
                  reference_type: 'product',
                  reference_oid: product_oid,
                  title: 'Created product',
                  performed_by: user_id,
                  description: `Created product "${payload.name}"`
            });
      } catch (e) {
            log.error(`An exception occurred while creating product: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Product ${payload.name} created successfully by: ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Product Created Successfully!",
      });
}

const get_category_oid_from_subcategory = async (sub_category_oid) => {
      try {
            const sql = {
                  text: `SELECT category_oid FROM ${TABLE.SUB_CATEGORIES} WHERE oid = $1`,
                  values: [sub_category_oid]
            };
            const data_set = await get_data(sql);
            return data_set.length > 0 ? data_set[0].category_oid : null;
      } catch (e) {
            log.error(`Error fetching category_oid for sub_category_oid ${sub_category_oid}: ${e?.message}`);
            return null;
      }
}

const check_existing_product = async (name) => {
      let count = 0;
      const sql = {
            text: `SELECT COUNT(oid)::int4 as total FROM ${TABLE.PRODUCT} WHERE name = $1 AND is_deleted = FALSE`,
            values: [name]
      }
      try {
            let data_set = await get_data(sql);
            count = data_set[0]["total"];
      } catch (e) {
            log.error(`An exception occurred while checking product count: ${e?.message}`);
            throw new Error(e);
      }
      return count;
}

module.exports = create_product
