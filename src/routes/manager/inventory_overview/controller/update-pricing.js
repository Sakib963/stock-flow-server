const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const update_pricing = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const sql = {
                  text: `update ${TABLE.INVENTORY} set selling_price = $1, maximum_discount = $2, status = $3, edited_on = clock_timestamp(), edited_by = $4 where oid = $5`,
                  values: [payload.selling_price, payload.maximum_discount, 'ready_for_sale', user_id, payload.oid]
            }
            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while updating batch : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Batch ${payload.oid} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Batch Updated Successfully!",
      });
}

module.exports = update_pricing