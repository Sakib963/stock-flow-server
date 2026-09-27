const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { read_product_stock_stats } = require("../../utils/product-stock-stats");

const DETAILS_SQL = `
      SELECT oid, name, description, origin_country, status, created_by, created_on, edited_by, edited_on,
             COALESCE(edited_on, created_on) AS last_action_on,
             COALESCE(edited_by, created_by) AS last_action_by
      FROM ${TABLE.BRANDS}
      WHERE oid = $1`;

const get_brand_details = async (request, res) => {
      try {
            const brandOid = request.params.oid;

            const [details] = await get_data({ text: DETAILS_SQL, values: [brandOid] });
            if (!details) {
                  log.warn(`Brand not found for oid: ${brandOid}`);
                  return res.status(404).json({ code: 404, message: "Brand not found", data: null });
            }

            const stats = await read_product_stock_stats("brand", brandOid);
            const activity_set = await getLogActivities('brand', brandOid, 5);

            return res.status(200).json({
                  code: 200,
                  message: "Brand details found successfully",
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
            log.error(`An exception occurred while getting brand details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something went wrong! Please try again later!" });
      }
};

module.exports = get_brand_details;
