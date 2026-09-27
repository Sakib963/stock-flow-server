const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { read_warehouse_stats } = require("../utils/warehouse-stats");

const DETAILS_SQL = `
      SELECT oid, name, code, location, capacity_units, status, created_by, created_on, edited_by, edited_on,
             COALESCE(edited_on, created_on) AS last_action_on,
             COALESCE(edited_by, created_by) AS last_action_by
      FROM ${TABLE.WAREHOUSE}
      WHERE oid = $1`;

const get_warehouse_details = async (request, res) => {
      try {
            const warehouseOid = request.params.oid;

            const [details] = await get_data({ text: DETAILS_SQL, values: [warehouseOid] });
            if (!details) {
                  log.warn(`Warehouse not found for oid: ${warehouseOid}`);
                  return res.status(404).json({ code: 404, message: "Warehouse not found", data: null });
            }

            const stats = await read_warehouse_stats(warehouseOid);
            const activity_set = await getLogActivities('warehouse', warehouseOid, 5);

            return res.status(200).json({
                  code: 200,
                  message: "Warehouse details found successfully",
                  data: {
                        details,
                        stats,
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
            log.error(`An exception occurred while getting warehouse details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something went wrong! Please try again later!" });
      }
};

module.exports = get_warehouse_details;
