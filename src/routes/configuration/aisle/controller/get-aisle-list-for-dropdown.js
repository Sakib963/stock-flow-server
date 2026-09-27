const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");

// Active aisles in Active warehouses, grouped by warehouse for the picker, narrowed to one warehouse
// when the form has already picked it.
const get_aisle_list_for_dropdown = async (request, res) => {
      const { warehouse_oid } = request.query;
      try {
            const data = await get_data({
                  text: `SELECT a.oid AS value, a.name AS label, a.warehouse_oid, w.name AS "groupLabel"
                         FROM ${TABLE.AISLE} a
                         JOIN ${TABLE.WAREHOUSE} w ON w.oid = a.warehouse_oid
                         WHERE a.status = 'Active' AND w.status = 'Active' AND ($1::text IS NULL OR a.warehouse_oid = $1)
                         ORDER BY w.name ASC, a.name ASC`,
                  values: [warehouse_oid || null],
            });

            return res.status(200).json({ code: 200, message: "Aisle list For Dropdown Found", data });
      } catch (e) {
            log.error(`An exception occurred while getting aisle list for dropdown information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not load aisles. Try again in a moment." });
      }
};

module.exports = get_aisle_list_for_dropdown;
