const { getLogActivities } = require("../../../../utils/activity-logger");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_supplier_details = async (request, res) => {
      try {
            const supplierOid = request.params.oid;

            // Step 1: Get supplier details
            const detailsSql = generate_details_sql(supplierOid);
            const details_set = await get_data(detailsSql);
            const details = details_set.length ? details_set[0] : null;

            if (!details) {
                  log.warn(`Supplier not found for oid: ${supplierOid}`);
                  return res.status(404).json({
                        code: 404,
                        message: "Supplier not found",
                        data: null,
                  });
            }

            // Step 2: Get supplier statistics
            const statsSql = generate_stats_sql(supplierOid);
            const stats_set = await get_data(statsSql);
            const stats = stats_set.length ? stats_set[0] : {
                  totalProducts: 0,
                  activeProducts: 0,
                  totalInventoryValue: 0,
                  totalAvailableQuantity: 0,
                  lowStockItems: 0,
                  outOfStockItems: 0,
                  averageProductPrice: 0
            };

            // Step 3: Get activity timeline (last 10 activities)
            const activity_set = await getLogActivities('supplier', supplierOid, 10);

            // Step 4: Combine all data
            const responseData = {
                  details: details,
                  stats: {
                        totalProducts: parseInt(stats.totalproducts) || 0,
                        activeProducts: parseInt(stats.activeproducts) || 0,
                        totalInventoryValue: parseFloat(stats.totalinventoryvalue) || 0,
                        totalAvailableQuantity: parseInt(stats.totalavailablequantity) || 0,
                        lowStockItems: parseInt(stats.lowstockitems) || 0,
                        outOfStockItems: parseInt(stats.outofstockitems) || 0,
                        averageProductPrice: parseFloat(stats.averageproductprice) || 0
                  },
                  activity: activity_set.map(a => ({
                        date: a.performed_on,
                        user: a.performed_by,
                        action: a.title,
                        description: a.description
                  }))
            };

            log.info(`Supplier details found for oid: ${supplierOid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Supplier details found successfully",
                  data: responseData,
            });
      } catch (e) {
            log.error(`An exception occurred while getting supplier details: ${e?.message}`);
            console.error(e);
            return res.status(500).json({ 
                  code: 500, 
                  message: "Something went wrong! Please try again later!" 
            });
      }
};

const generate_details_sql = (supplierOid) => {
      const query = `
            SELECT 
                  oid,
                  name,
                  contact_person,
                  phone_number,
                  email,
                  address,
                  status,
                  created_by,
                  created_on,
                  edited_by,
                  edited_on
            FROM ${TABLE.SUPPLIER} 
            WHERE oid = $1
      `;
      return { text: query, values: [supplierOid] };
};

const generate_stats_sql = (supplierOid) => {
      const query = `
            WITH product_inventory AS (
                  SELECT 
                        p.oid as product_oid,
                        p.status,
                        p.is_deleted,
                        p.restock_threshold,
                        COALESCE(SUM(i.quantity_available), 0) as total_quantity,
                        ROUND(COALESCE(SUM(i.quantity_available * i.selling_price), 0)::numeric, 2) as inventory_value,
                        ROUND(COALESCE(AVG(i.selling_price), 0)::numeric, 2) as avg_price
                  FROM ${TABLE.PRODUCT} p
                  LEFT JOIN ${TABLE.INVENTORY} i ON p.oid = i.product_oid 
                        AND i.status IN ('ready_for_sale', 'pending_pricing')
                  WHERE p.supplier_oid = $1
                        AND p.is_deleted = FALSE
                  GROUP BY p.oid, p.status, p.is_deleted, p.restock_threshold
            )
            SELECT 
                  COUNT(*) as totalProducts,
                  COUNT(CASE WHEN status = 'Active' AND is_deleted = FALSE THEN 1 END) as activeProducts,
                  ROUND(COALESCE(SUM(inventory_value), 0)::numeric, 2) as totalInventoryValue,
                  COALESCE(SUM(total_quantity), 0) as totalAvailableQuantity,
                  COUNT(CASE 
                        WHEN total_quantity > 0 
                        AND total_quantity <= restock_threshold 
                        AND status = 'Active' 
                        AND is_deleted = FALSE
                        THEN 1 
                  END) as lowStockItems,
                  COUNT(CASE 
                        WHEN total_quantity = 0 
                        AND status = 'Active' 
                        AND is_deleted = FALSE
                        THEN 1 
                  END) as outOfStockItems,
                  ROUND(COALESCE(AVG(NULLIF(avg_price, 0)), 0)::numeric, 2) as averageProductPrice
            FROM product_inventory
      `;
      return { text: query, values: [supplierOid] };
};

module.exports = get_supplier_details;