const { TABLE } = require("../../../../utils/constant");
const { read_choices } = require("../../../../db/list-query");
const { log } = require("../../../../utils/log");

// Searched by its own name or its category's, so typing a category finds everything under it. Picking
// offers active ones under active categories; naming by oids takes any, so a product keeps showing its own.
const get_sub_category_list_for_dropdown = async (request, res) => {
      const { category_oid, oids } = request.query;
      try {
            const where = oids ? [] : ["sc.status = 'Active'", "c.status = 'Active'"];
            const values = [];
            if (category_oid) {
                  values.push(category_oid);
                  where.push(`sc.category_oid = $${values.length}`);
            }
            const data = await read_choices({
                  select: `sc.oid AS value, sc.name AS label, sc.category_oid, c.name AS "groupLabel"`,
                  from: `${TABLE.SUB_CATEGORIES} sc JOIN ${TABLE.CATEGORIES} c ON c.oid = sc.category_oid`,
                  key: "sc.oid",
                  where,
                  values,
                  search: ["sc.name", "c.name"],
                  order: "c.name, sc.name",
                  query: request.query,
            });
            return res.status(200).json({ code: 200, message: "Sub-categories", data });
      } catch (e) {
            log.error(`An exception occurred while loading sub-categories for a dropdown: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load sub-categories. Try again in a moment." });
      }
};

module.exports = get_sub_category_list_for_dropdown;
