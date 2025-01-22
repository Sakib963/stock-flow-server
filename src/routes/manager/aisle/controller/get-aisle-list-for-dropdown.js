const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_aisle_list_for_dropdown = async (request, res) => {
      try {
            const dataSql = generate_data_sql(request);

            const data_set = await get_data(dataSql);
            const data = data_set.length ? data_set : [];

            // Step 3: Respond with total count and paginated data
            log.info(`Aisle list for dropdown Found: ${data?.length}`);
            return res.status(200).json({
                  code: 200,
                  message: "Aisle list For Dropdown Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting aisle list for dropdown information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_data_sql = (request) => {
      let query = `SELECT a.oid as value, a.name as label  FROM ${TABLE.AISLE} a WHERE a.status = 'Active' AND a.warehouse_oid = $1 ORDER BY a.created_on ASC`;
      let values = [request.query.warehouse_oid];
      return { text: query, values };
};

module.exports = get_aisle_list_for_dropdown;
