const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { read_supplier_stats } = require("../utils/supplier-stats");

const DETAILS_SQL = `
      SELECT oid, name, contact_person, phone_number, whatsapp_number, email, address, payment_details, status,
             created_by, created_on, edited_by, edited_on,
             COALESCE(edited_on, created_on) AS last_action_on,
             COALESCE(edited_by, created_by) AS last_action_by
      FROM ${TABLE.SUPPLIER}
      WHERE oid = $1`;

const get_supplier_details = async (request, res) => {
      try {
            const supplierOid = request.params.oid;

            const [details] = await get_data({ text: DETAILS_SQL, values: [supplierOid] });
            if (!details) {
                  log.warn(`Supplier not found for oid: ${supplierOid}`);
                  return res.status(404).json({ code: 404, message: "Supplier not found", data: null });
            }

            const stats = await read_supplier_stats(supplierOid);
            const activity_set = await getLogActivities('supplier', supplierOid, 5);

            return res.status(200).json({
                  code: 200,
                  message: "Supplier details found successfully",
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
            log.error(`An exception occurred while getting supplier details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something went wrong! Please try again later!" });
      }
};

module.exports = get_supplier_details;
