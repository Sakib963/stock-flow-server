const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// Each field compared with its unique index's own expression: a name within its warehouse, a code
// everywhere. The schema allows no other `field`, so the text is a lookup and never comes from the request.
const COMPARE = {
      name: 'lower(btrim(name)) = lower(btrim($1)) AND warehouse_oid = $3',
      code: 'upper(btrim(code)) = upper(btrim($1))',
};

const check_aisle_availability = async (request, res) => {
      const { field, value, warehouse_oid, oid } = request.query;

      try {
            const values = field === 'name' ? [value, oid || null, warehouse_oid] : [value, oid || null];
            const rows = await get_data({
                  text: `SELECT 1 FROM ${TABLE.AISLE} WHERE ${COMPARE[field]} AND ($2::text IS NULL OR oid <> $2) LIMIT 1`,
                  values,
            });

            return res.status(200).json({ code: 200, message: "OK", data: { field, available: rows.length === 0 } });
      } catch (e) {
            log.error(`An exception occurred while checking aisle ${field} availability : ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

module.exports = check_aisle_availability;
