const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

const DROPDOWN_SQL = {
      text: `SELECT oid AS value, name AS label, phone_number FROM ${TABLE.SUPPLIER} WHERE status = 'Active' ORDER BY name ASC`,
      values: [],
};

const get_supplier_list_for_dropdown = async (request, res) => {
      try {
            const data = await get_data(DROPDOWN_SQL);

            return res.status(200).json({
                  code: 200,
                  message: "Supplier list For Dropdown Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting supplier list for dropdown information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load suppliers. Try again in a moment." });
      }
};

module.exports = get_supplier_list_for_dropdown;
