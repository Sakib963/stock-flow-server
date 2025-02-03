const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_details = async (request, res) => {
      try {
            let data;
            const productSql = generate_product_data_sql(request);
            const batchSql = generate_batch_data_sql(request);

            let product_data = null;
            let batch_data = [];
            try {
                  const data_set = await get_data(productSql);
                  product_data = data_set.length ? data_set[0] : null;
            } catch (e) {
                  log.error(`An exception occurred while getting Product details: ${e?.message}`);
                  throw e;
            }
            try {
                  const data_set = await get_data(batchSql);
                  batch_data = data_set.length ? data_set : [];
            } catch (e) {
                  log.error(`An exception occurred while getting Product batch list: ${e?.message}`);
                  throw e;
            }

            data = {
                  ...product_data, batch_data
            }

            // Step 2: Respond with data
            log.info(`Purchase details Found for oid: ${request.query.product_oid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Purchase details Found",
                  data,
            });
      } catch (e) {
            log.error(`An exception occurred while getting Purchase details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_product_data_sql = (request) => {
      let query = `select p.oid, p.name, p.sku, p.category_oid, p.sub_category_oid, p.unit_type, p.description, p.photo, p.product_nature, p.restock_threshold, p.status, c.name as category_name, sc.name as sub_category_name from ${TABLE.PRODUCT} p LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid LEFT JOIN ${TABLE.SUB_CATEGORIES} sc ON sc.oid = p.sub_category_oid where p.oid = $1`;
      let values = [request.query.product_oid];

      return { text: query, values };
};

const generate_batch_data_sql = (request) => {
      let query = `select CAST(bd.unit_price as INTEGER) as unit_price , CAST(bd.total_price as INTEGER) as total_price, CAST(bd.purchase_quantity as INTEGER) as purchase_quantity, CAST(bd.available_quantity as INTEGER) as available_quantity, s."name" as supplier_name, w."name" as warehouse_name, a."name" as aisle_name, b.batch_code
            from ${TABLE.BATCH_DETAILS} bd 
            left join ${TABLE.BATCH} b on b.oid = bd.batch_oid
            left join ${TABLE.WAREHOUSE} w on w.oid = bd.warehouse_oid 
            left join ${TABLE.AISLE} a on a.oid = bd.aisle_oid 
            left join ${TABLE.SUPPLIER} s on s.oid = bd.supplier_oid 
      where bd.product_oid = $1`;
      let values = [request.query.product_oid];

      return { text: query, values };
};

module.exports = get_product_details;
