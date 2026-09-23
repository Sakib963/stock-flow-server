const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

// The two columns the unique indexes cover. The same expression is applied to the value as to the
// column, so the comparison is literally the index's own, rather than a JS approximation of it that
// only happens to agree. The schema allows no other value for `field`, so the text here is a lookup
// and never comes from the request.
const COLUMNS = {
      name: 'lower(btrim($1))',
      category_code: 'upper(btrim($1))',
};

const COLUMN_EXPRESSION = {
      name: 'lower(btrim(name))',
      category_code: 'upper(btrim(category_code))',
};

const check_category_availability = async (request, res) => {
      const { field, value, oid } = request.query;

      try {
            // `oid` is the category being edited. Excluding it stops a form reporting a category's
            // own name as taken when the person changes something else and leaves the name alone.
            const sql = {
                  text: `SELECT 1 FROM ${TABLE.CATEGORIES} WHERE ${COLUMN_EXPRESSION[field]} = ${COLUMNS[field]} AND ($2::text IS NULL OR oid <> $2) LIMIT 1`,
                  values: [value, oid || null],
            };
            const rows = await get_data(sql);

            return res.status(200).json({
                  code: 200,
                  message: "OK",
                  data: { field, available: rows.length === 0 },
            });
      } catch (e) {
            log.error(`An exception occurred while checking category ${field} availability : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
}

module.exports = check_category_availability
