const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_product_details = async (request, res) => {
      try {
            const productOid = request.params.oid;

            // Get product details
            const detailsSql = generate_product_details_sql(productOid);
            const detailsData = await get_data(detailsSql);
            const details = detailsData.length ? detailsData[0] : null;

            if (!details) {
                  return res.status(404).json({
                        code: 404,
                        message: "Product not found",
                  });
            }

            // Get product statistics
            const statsSql = generate_product_stats_sql(productOid);
            const statsData = await get_data(statsSql);
            const stats = statsData.length ? statsData[0] : null;

            // Get inventory summary
            const inventorySql = generate_inventory_summary_sql(productOid);
            const inventoryData = await get_data(inventorySql);
            const inventory = inventoryData.length ? inventoryData[0] : {
                  total_quantity: 0,
                  total_value: 0,
                  warehouse_count: 0,
                  available_quantity: 0,
                  avg_cost_price: 0,
                  avg_selling_price: 0
            };

            // Get activity timeline (last 10 activities)
            const activitySql = generate_activity_timeline_sql(productOid);
            const activityData = await get_data(activitySql);

            // Combine all data
            const responseData = {
                  details,
                  stats,
                  inventory,
                  activity: activityData
            };

            log.info(`Product details with insights found for oid: ${productOid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Product details Found",
                  data: responseData,
            });
      } catch (e) {
            log.error(`An exception occurred while getting product details: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Something Went Wrong! Please try again later!" });
      }
};

const generate_product_details_sql = (productOid) => {
      const query = `
            SELECT 
                  p.oid, 
                  p.name, 
                  p.sku, 
                  p.category_oid, 
                  p.sub_category_oid, 
                  p.unit_type, 
                  p.description, 
                  p.photo, 
                  p.product_nature, 
                  p.restock_threshold, 
                  p.status,
                  p.created_by,
                  p.created_on,
                  p.edited_by,
                  p.edited_on,
                  c.name as category_name, 
                  sc.name as sub_category_name, 
                  p.brand_oid, 
                  b.name as brand_name 
            FROM ${TABLE.PRODUCT} p 
            LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid 
            LEFT JOIN ${TABLE.SUB_CATEGORIES} sc ON sc.oid = p.sub_category_oid 
            LEFT JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid 
            WHERE p.oid = $1 AND p.is_deleted = FALSE`;
      
      return { text: query, values: [productOid] };
};

const generate_product_stats_sql = (productOid) => {
      const query = `
            SELECT 
                  COALESCE(ps.total_sold, 0)::int as total_sold,
                  COALESCE(ps.total_returned, 0)::int as total_returned,
                  COALESCE(ps.total_damaged, 0)::int as total_damaged,
                  COALESCE(ps.total_wasted, 0)::int as total_wasted,
                  ps.last_edited_on
            FROM ${TABLE.PRODUCT_STATS} ps
            WHERE ps.product_oid = $1`;
      
      return { text: query, values: [productOid] };
};

const generate_inventory_summary_sql = (productOid) => {
      const query = `
            SELECT 
                  COALESCE(SUM(i.initial_quantity), 0)::int as total_quantity,
                  COALESCE(SUM(i.quantity_available), 0)::int as available_quantity,
                  COALESCE(SUM(i.quantity_available * i.cost_price), 0)::numeric(14,2) as total_value,
                  COUNT(DISTINCT pd.warehouse_oid)::int as warehouse_count,
                  COALESCE(AVG(i.cost_price), 0)::numeric(10,2) as avg_cost_price,
                  COALESCE(AVG(i.selling_price), 0)::numeric(10,2) as avg_selling_price,
                  COUNT(DISTINCT i.batch_code)::int as batch_count
            FROM ${TABLE.INVENTORY} i
            INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.oid = i.purchase_details_oid
            WHERE i.product_oid = $1`;
      
      return { text: query, values: [productOid] };
};

const generate_activity_timeline_sql = (productOid) => {
      const query = `
            SELECT 
                  al.title,
                  al.description,
                  al.performed_by,
                  al.performed_on,
                  l.name as performed_by_name
            FROM ${TABLE.ACTIVITY_LOG} al
            LEFT JOIN ${TABLE.LOGIN} l ON l.email = al.performed_by
            WHERE al.reference_oid = $1 
            AND al.reference_type = 'product'
            ORDER BY al.performed_on DESC
            LIMIT 10`;
      
      return { text: query, values: [productOid] };
};

module.exports = get_product_details;
