const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_sub_category_details = async (request, res) => {
      try {
            // Step 1: Generate SQL for paginated data
            const dataSql = generate_data_sql(request);

            const data_set = await get_data(dataSql);
            const data = data_set.length ? data_set[0] : null;

            // Step 2: Respond with data
            log.info(`Sub Category details Found for oid: ${request.query.oid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Sub Category details Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting sub category details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_data_sql = (request) => {
      let query = `SELECT sc.oid, sc.name, sc.description, sc.status, sc.category_code, c.name as category_name, sc.category_oid  FROM ${TABLE.SUB_CATEGORIES} sc LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = sc.category_oid WHERE sc.oid = $1`;
      let values = [request.query.oid];

      return { text: query, values };
};

module.exports = get_sub_category_details;
