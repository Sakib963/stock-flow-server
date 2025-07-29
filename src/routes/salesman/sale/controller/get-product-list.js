const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_list = async (request, res) => {
      try {
            let user_id = request.credentials.user_id;

            // Step 1: Generate SQL for data
            const dataSql = generate_data_sql(request);

            const data_set = await get_data(dataSql);
            const data = data_set.length ? data_set : [];

            // Step 2: Respond with data
            log.info(`Product list For Sale Found: ${data?.length}`);
            return res.status(200).json({
                  code: 200,
                  message: "Product list For Sale Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting Product list For Sale information: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_data_sql = (request) => {
      let query = `
    SELECT 
      sc.oid AS sub_category_oid,
      sc.name AS sub_category_name,
      c.name AS category_name,
      c.category_code,
      p.oid AS product_oid,
      p.name AS product_name,
      p.photo AS image_url,
      p.sku,
      i.oid AS inventory_oid,
      i.batch_code,
      i.quantity_available,
      i.selling_price,
      i.maximum_discount
    FROM ${TABLE.INVENTORY} i
    LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
    LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
    LEFT JOIN ${TABLE.SUB_CATEGORIES} sc ON sc.oid = p.sub_category_oid
    LEFT JOIN ${TABLE.PRODUCT_STATS} ps ON ps.product_oid = p.oid
    WHERE i.intended_use = 'for_sale' 
      AND i.quantity_available > 0 
      AND i.status = 'ready_for_sale'
  `;

      const values = [];

      if (request.query.search_text && request.query.search_text.trim() !== "") {
            const searchText = `%${request.query.search_text.trim().toLowerCase()}%`;
            values.push(searchText, searchText, searchText, searchText, searchText, searchText, searchText);

            query += `
      AND (
        LOWER(p.name) LIKE $${values.length - 6} OR
        LOWER(p.sku) LIKE $${values.length - 5} OR
        LOWER(c.name) LIKE $${values.length - 4} OR
        LOWER(c.category_code) LIKE $${values.length - 3} OR
        LOWER(sc.name) LIKE $${values.length - 2} OR
        LOWER(i.batch_code) LIKE $${values.length - 1} OR
        CAST(i.selling_price AS TEXT) LIKE $${values.length}
      )
    `;
      }

      query += ` ORDER BY sc.name, p.name, i.selling_price LIMIT 50`;

      return { text: query, values };
};

module.exports = get_product_list;
