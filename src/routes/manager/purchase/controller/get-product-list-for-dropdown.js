const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_list_for_dropdown = async (request, res) => {
      try {
            const dataSql = generate_data_sql(request);

            const data_set = await get_data(dataSql);
            const data = data_set.length ? data_set : [];

            // Step 3: Respond with total count and paginated data
            log.info(`Product list for dropdown Found: ${data?.length}`);
            return res.status(200).json({
                  code: 200,
                  message: "Product list For Dropdown Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting product list for dropdown information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_data_sql = (request) => {
      let query = `SELECT oid as value, name as label  FROM ${TABLE.PRODUCT} WHERE status = 'Active' ORDER BY created_on ASC`;
      let values = [];
      return { text: query, values };
};

module.exports = get_product_list_for_dropdown;
