const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { read_aisle_stock } = require("../utils/aisle-stats");

const DETAILS_SQL = `
      SELECT a.oid, a.name, a.code, a.warehouse_oid, w.name AS warehouse_name, a.storage_type, a.capacity_units, a.special_notes, a.status,
             a.created_by, a.created_on, a.edited_by, a.edited_on,
             COALESCE(a.edited_on, a.created_on) AS last_action_on,
             COALESCE(a.edited_by, a.created_by) AS last_action_by
      FROM ${TABLE.AISLE} a
      JOIN ${TABLE.WAREHOUSE} w ON w.oid = a.warehouse_oid
      WHERE a.oid = $1`;

const get_aisle_details = async (request, res) => {
      try {
            const aisleOid = request.params.oid;

            const [details] = await get_data({ text: DETAILS_SQL, values: [aisleOid] });
            if (!details) {
                  log.warn(`Aisle not found for oid: ${aisleOid}`);
                  return res.status(404).json({ code: 404, message: "Aisle not found", data: null });
            }

            const { stats, items } = await read_aisle_stock(aisleOid, details.capacity_units);
            const activity_set = await getLogActivities('aisle', aisleOid, 5);

            return res.status(200).json({
                  code: 200,
                  message: "Aisle details found successfully",
                  data: {
                        details,
                        stats,
                        items,
                        activity: activity_set.map(a => ({
                              oid: a.oid,
                              date: a.performed_on,
                              user: a.performed_by,
                              action: a.title,
                              description: a.description
                        })),
                  },
            });
      } catch (e) {
            log.error(`An exception occurred while getting aisle details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something went wrong! Please try again later!" });
      }
};

module.exports = get_aisle_details;
