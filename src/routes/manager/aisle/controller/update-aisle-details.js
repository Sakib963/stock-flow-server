const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const update_aisle_details = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const sql = {
                  text: `update ${TABLE.AISLE} set name = $1, code = $2, warehouse_oid = $3, capacity = $4, type_of_storage = $5, special_notes = $6, status = $7, edited_on = clock_timestamp(), edited_by = $8 where oid = $9`,
                  values: [payload.name, payload.code, payload.warehouse_oid, payload.capacity, payload.type_of_storage, payload.special_notes, payload.status, user_id, payload.oid]
            }
            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while updating aisle : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Aisle ${payload.email} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Aisle Updated Successfully!",
      });
}

module.exports = update_aisle_details