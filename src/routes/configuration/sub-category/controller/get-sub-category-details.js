const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { read_product_stock_stats } = require("../../utils/product-stock-stats");

const get_sub_category_details = async (request, res) => {
      const oid = request.params.oid;
      try {
            const [details] = await get_data({
                  text: `SELECT sc.oid, sc.name, sc.description, sc.status, sc.category_code, sc.category_oid,
                                c.name AS category_name,
                                sc.created_by, sc.created_on, sc.edited_by, sc.edited_on,
                                COALESCE(sc.edited_on, sc.created_on) AS last_action_on,
                                COALESCE(sc.edited_by, sc.created_by) AS last_action_by
                         FROM ${TABLE.SUB_CATEGORIES} sc
                         JOIN ${TABLE.CATEGORIES} c ON c.oid = sc.category_oid
                         WHERE sc.oid = $1`,
                  values: [oid],
            });

            if (!details) {
                  log.warn(`Sub-category not found for oid: ${oid}`);
                  return res.status(404).json({ code: 404, message: "Sub-category not found", data: null });
            }

            const stats = await read_product_stock_stats("sub_category", oid);
            const activity = await getLogActivities("sub-category", oid, 10);

            return res.status(200).json({
                  code: 200,
                  message: "Sub-category details found successfully",
                  data: {
                        details,
                        stats,
                        activity: activity.map((a) => ({ oid: a.oid, date: a.performed_on, user: a.performed_by, action: a.title, description: a.description })),
                  },
            });
      } catch (e) {
            log.error(`An exception occurred while getting sub-category details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something went wrong! Please try again later!" });
      }
};

module.exports = get_sub_category_details;
