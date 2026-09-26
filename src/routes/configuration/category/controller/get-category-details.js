const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { read_product_stock_stats } = require("../../utils/product-stock-stats");

const get_category_details = async (request, res) => {
      try {
            const categoryOid = request.params.oid;

            const detailsSql = generate_details_sql(categoryOid);
            const details_set = await get_data(detailsSql);
            const details = details_set.length ? details_set[0] : null;

            if (!details) {
                  log.warn(`Category not found for oid: ${categoryOid}`);
                  return res.status(404).json({
                        code: 404,
                        message: "Category not found",
                        data: null,
                  });
            }

            const stats = await read_product_stock_stats("category", categoryOid);

            const activity_set = await getLogActivities('category', categoryOid, 10);

            const responseData = {
                  details: details,
                  stats,
                  // The oid rides along so the timeline can be keyed on it. Keyed on the timestamp,
                  // two entries recorded in the same millisecond collided and one of them vanished.
                  activity: activity_set.map(a => ({
                        oid: a.oid,
                        date: a.performed_on,
                        user: a.performed_by,
                        action: a.title,
                        description: a.description
                  }))
            };

            log.info(`Category details found for oid: ${categoryOid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Category details found successfully",
                  data: responseData,
            });
      } catch (e) {
            log.error(`An exception occurred while getting category details: ${e?.message}`);
            return res.status(500).json({ 
                  code: 500, 
                  message: "Something went wrong! Please try again later!" 
            });
      }
};

const generate_details_sql = (categoryOid) => {
      const query = `
            SELECT 
                  oid, 
                  name, 
                  description, 
                  status, 
                  category_code, 
                  created_by, 
                  created_on, 
                  edited_by, 
                  edited_on,
                  COALESCE(edited_on, created_on) AS last_action_on,
                  COALESCE(edited_by, created_by) AS last_action_by
            FROM ${TABLE.CATEGORIES} 
            WHERE oid = $1
      `;
      return { text: query, values: [categoryOid] };
};

module.exports = get_category_details;
