const { TABLE } = require("../../../../utils/constant");
const { get_data, execute_value } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const update_supplier_dealer_details = async (request, res) => {
      let payload = request.body;
      let user_id = request.credentials.user_id;
      try {
            const sql = {
                  text: `update ${TABLE.SOURCE} set name = $1, source_type = $2, contact_person = $3, phone_number = $4, email = $5, address = $6, status = $7, edited_on = clock_timestamp(), edited_by = $8 where oid = $9`,
                  values: [payload.name, payload.source_type, payload.contact_person, payload.phone_number, payload.email, payload.address, payload.status, user_id, payload.oid]
            }
            await execute_value(sql);
      } catch (e) {
            log.error(`An exception occurred while updating supplier/dealer : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }

      log.info(`Supplier/Dealer ${payload.email} updated successfully by : ${user_id}`);
      return res.status(200).json({
            code: 200,
            message: "Supplier/Dealer Updated Successfully!",
      });
}

module.exports = update_supplier_dealer_details