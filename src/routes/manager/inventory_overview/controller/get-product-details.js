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
      let query = `select i.oid as inventory_oid, CAST(i.cost_price as INTEGER) as cost_price , CAST(i.selling_price as INTEGER) as selling_price, CAST(i.initial_quantity as INTEGER) as initial_quantity, CAST(i.quantity_available as INTEGER) as quantity_available, s."name" as supplier_name, w."name" as warehouse_name, a."name" as aisle_name, i.batch_code, i.intended_use, i.maximum_discount, i.status ,
      (i.quantity_available * i.cost_price) AS total_stock_cost,
      CASE 
            WHEN i.intended_use = 'for_sale'
                  AND i.status = 'ready_for_sale'
                  AND i.selling_price IS NOT NULL
            THEN (i.quantity_available * i.selling_price)
            ELSE 0
      END AS expected_revenue,
      CASE 
            WHEN i.intended_use = 'for_sale'
                  AND i.status = 'ready_for_sale'
                  AND i.selling_price IS NOT NULL
            THEN (i.quantity_available * (i.selling_price - i.cost_price))
            ELSE 0
      END AS potential_profit
            from ${TABLE.INVENTORY} i 
            left join ${TABLE.PURCHASE_DETAILS} pd ON pd.oid = i.purchase_details_oid
            left join ${TABLE.PURCHASE} p ON p.oid = pd.purchase_oid
            left join ${TABLE.WAREHOUSE} w on w.oid = pd.warehouse_oid 
            left join ${TABLE.AISLE} a on a.oid = pd.aisle_oid 
            left join ${TABLE.SUPPLIER} s on s.oid = p.supplier_oid 
      where i.product_oid = $1`;
      let values = [request.query.product_oid];

      return { text: query, values };
};

module.exports = get_product_details;
