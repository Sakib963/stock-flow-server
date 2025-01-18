const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const update_supplier_details = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const sql = {
                  text: `update ${TABLE.SUPPLIER} set name = $1, contact_person = $2, phone_number = $3, email = $4, address = $5, status = $6, edited_on = clock_timestamp(), edited_by = $7 where oid = $8`,
                  values: [payload.name, payload.contact_person, payload.phone_number, payload.email, payload.address, payload.status, user_id, payload.oid]
            }
            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while updating supplier : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Supplier ${payload.email} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Supplier Updated Successfully!",
      });
}

module.exports = update_supplier_details