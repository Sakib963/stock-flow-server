const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// The comparison each unique index makes, applied to both sides. A name is compared within its
// parent category, which the schema requires for `name` and forbids for `category_code`.
const MATCH = {
      name: "category_oid = $3 AND lower(btrim(name)) = lower(btrim($1))",
      category_code: "upper(btrim(category_code)) = upper(btrim($1))",
};

const check_sub_category_availability = async (request, res) => {
      const { field, value, oid, category_oid } = request.query;

      try {
            const rows = await get_data({
                  text: `SELECT 1 FROM ${TABLE.SUB_CATEGORIES} WHERE ${MATCH[field]} AND ($2::text IS NULL OR oid <> $2) LIMIT 1`,
                  values: field === "name" ? [value, oid || null, category_oid] : [value, oid || null],
            });

            return res.status(200).json({ code: 200, message: "OK", data: { field, available: rows.length === 0 } });
      } catch (e) {
            log.error(`An exception occurred while checking sub-category ${field} availability : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

module.exports = check_sub_category_availability;
