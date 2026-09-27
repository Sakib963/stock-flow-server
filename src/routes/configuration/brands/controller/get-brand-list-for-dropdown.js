const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

const DROPDOWN_SQL = {
      text: `SELECT oid AS value, name AS label FROM ${TABLE.BRANDS} WHERE status = 'Active' ORDER BY name ASC`,
      values: [],
};

const get_brand_list_for_dropdown = async (request, res) => {
      try {
            const data = await get_data(DROPDOWN_SQL);

            return res.status(200).json({
                  code: 200,
                  message: "Brand list For Dropdown Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting brand list for dropdown information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load brands. Try again in a moment." });
      }
};

module.exports = get_brand_list_for_dropdown;
