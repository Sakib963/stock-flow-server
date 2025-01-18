const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const update_product_details = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const sql = {
                  text: `update ${TABLE.PRODUCT} set name = $1, sku = $2, category_oid = $3, sub_category_oid = $4, unit_type = $5, description = $6, photo = $7, product_nature = $8, restock_threshold = $9, status = $10, edited_on = clock_timestamp(), edited_by = $11 WHERE oid = $12`,
                  values: [payload.name, payload.sku, payload.category_oid, payload.sub_category_oid, payload.unit_type, payload.description, payload.photo, payload.product_nature, payload.restock_threshold, payload.status, user_id, payload.oid]
            }
            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while updating product : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Product ${payload.name} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Product Updated Successfully!",
      });
}

module.exports = update_product_details