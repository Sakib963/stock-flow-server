const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// Active only, and ordered by name rather than by when it was added: this fills a picker someone
// scans for a word, and creation order is not an order anyone can look something up in.
const DROPDOWN_SQL = {
      text: `SELECT oid AS value, name AS label FROM ${TABLE.CATEGORIES} WHERE status = 'Active' ORDER BY name ASC`,
      values: [],
};

const get_category_list_for_dropdown = async (request, res) => {
      try {
            const data = await get_data(DROPDOWN_SQL);

            return res.status(200).json({
                  code: 200,
                  message: "Category list For Dropdown Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting category list for dropdown information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load categories. Try again in a moment." });
      }
};

module.exports = get_category_list_for_dropdown;
