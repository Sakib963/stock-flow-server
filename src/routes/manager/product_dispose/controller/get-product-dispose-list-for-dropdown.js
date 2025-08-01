const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_list_for_dispose_dropdown = async (request, res) => {
      try {
            const dataSql = generate_data_sql(request);

            const data_set = await get_data(dataSql);
            const data = data_set.length ? data_set : [];

            // Step 3: Respond with total count and paginated data
            log.info(`Product list for dispose dropdown Found: ${data?.length}`);
            return res.status(200).json({
                  code: 200,
                  message: "Product list For Dispose Dropdown Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting product list for dispose dropdown information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_data_sql = (request) => {
      let query = `SELECT i.oid as inventory_oid, i.product_oid, i.batch_code, i.quantity_available, p.name as product_name,
      p.name || ' (' || i.batch_code || ')' AS label FROM ${TABLE.INVENTORY} i LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid where i.quantity_available > 0`;
      let values = [];
      return { text: query, values };
};

module.exports = get_product_list_for_dispose_dropdown;
