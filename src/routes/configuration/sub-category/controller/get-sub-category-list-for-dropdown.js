const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// Active sub-categories under Active categories, grouped by their category for the picker. The old
// query checked only the category, so an Inactive sub-category was still offered on new products.
const get_sub_category_list_for_dropdown = async (request, res) => {
      const { category_oid } = request.query;
      try {
            const data = await get_data({
                  text: `SELECT sc.oid AS value, sc.name AS label, sc.category_oid, c.name AS "groupLabel"
                         FROM ${TABLE.SUB_CATEGORIES} sc
                         JOIN ${TABLE.CATEGORIES} c ON c.oid = sc.category_oid
                         WHERE sc.status = 'Active' AND c.status = 'Active' AND ($1::text IS NULL OR sc.category_oid = $1)
                         ORDER BY c.name ASC, sc.name ASC`,
                  values: [category_oid || null],
            });

            return res.status(200).json({ code: 200, message: "Sub-Category list For Dropdown Found", data });
      } catch (e) {
            log.error(`An exception occurred while getting sub-category list for dropdown information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load sub-categories. Try again in a moment." });
      }
};

module.exports = get_sub_category_list_for_dropdown;
