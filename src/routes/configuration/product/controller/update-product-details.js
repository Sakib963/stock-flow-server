const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const { saveLogActivity } = require("../../../../utils/activity-logger");

const update_product_details = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
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

            const sql = {
                  text: `UPDATE ${TABLE.PRODUCT} SET name = $1, sku = $2, category_oid = $3, sub_category_oid = $4, unit_type = $5, description = $6, photo = $7, product_nature = $8, restock_threshold = $9, status = $10, edited_on = clock_timestamp(), edited_by = $11, brand_oid = $12 WHERE oid = $13`,
                  values: [payload.name, sku, category_oid, payload.sub_category_oid, unit_type, description, photo, payload.product_nature, payload.restock_threshold, payload.status, user_id, brand_oid, payload.oid]
            }
            await execute_value(sql);

            // Log activity (non-blocking - fire and forget)
            saveLogActivity({
                  reference_type: 'product',
                  reference_oid: payload.oid,
                  title: 'Updated product',
                  performed_by: user_id,
                  description: `Updated product "${payload.name}"`
            });
      } catch (e) {
            log.error(`An exception occurred while updating product: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Product ${payload.name} updated successfully by: ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Product Updated Successfully!",
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

module.exports = update_product_details
