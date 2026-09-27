const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// Compared with the unique index's own expression, so the answer is the one the insert will get.
const check_brand_availability = async (request, res) => {
      const { value, oid } = request.query;

      try {
            const rows = await get_data({
                  text: `SELECT 1 FROM ${TABLE.BRANDS} WHERE lower(btrim(name)) = lower(btrim($1)) AND ($2::text IS NULL OR oid <> $2) LIMIT 1`,
                  values: [value, oid || null],
            });

            return res.status(200).json({
                  code: 200,
                  message: "OK",
                  data: { field: "name", available: rows.length === 0 },
            });
      } catch (e) {
            log.error(`An exception occurred while checking brand name availability : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
}

module.exports = check_brand_availability
