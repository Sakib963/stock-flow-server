const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_details = async (request, res) => {
      try {
            const dataSql = generate_data_sql(request);

            const data_set = await get_data(dataSql);
            const data = data_set.length ? data_set[0] : null;

            // Step 2: Respond with data
            log.info(`Product details Found for oid: ${request.query.oid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Product details Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting product details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_data_sql = (request) => {
      let query = `SELECT p.oid, p.name, p.sku, p.category_oid, p.sub_category_oid, p.unit_type, p.description, p.photo, p.product_nature, p.restock_threshold, p.status, c.name as category_name, sc.name as sub_category_name FROM ${TABLE.PRODUCT} p LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid LEFT JOIN ${TABLE.SUB_CATEGORIES} sc ON sc.oid = p.sub_category_oid WHERE p.oid = $1`;
      let values = [request.query.oid];

      return { text: query, values };
};

module.exports = get_product_details;
