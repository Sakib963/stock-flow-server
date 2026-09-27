const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// Each field compared with its unique index's own expression. The schema allows no other `field`,
// so the text here is a lookup and never comes from the request.
const COMPARE = {
      name: 'lower(btrim(name)) = lower(btrim($1))',
      code: 'upper(btrim(code)) = upper(btrim($1))',
};

const check_warehouse_availability = async (request, res) => {
      const { field, value, oid } = request.query;

      try {
            const rows = await get_data({
                  text: `SELECT 1 FROM ${TABLE.WAREHOUSE} WHERE ${COMPARE[field]} AND ($2::text IS NULL OR oid <> $2) LIMIT 1`,
                  values: [value, oid || null],
            });

            return res.status(200).json({
                  code: 200,
                  message: "OK",
                  data: { field, available: rows.length === 0 },
            });
      } catch (e) {
            log.error(`An exception occurred while checking warehouse ${field} availability : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
}

module.exports = check_warehouse_availability
