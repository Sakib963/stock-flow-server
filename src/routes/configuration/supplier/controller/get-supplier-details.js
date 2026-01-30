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

            // Step 2: Get supplier statistics (supplier-specific metrics)
            const statsSql = generate_stats_sql(supplierOid);
            const stats_set = await get_data(statsSql);
            const stats = stats_set.length ? stats_set[0] : {
                  totalProducts: 0,
                  totalPurchaseValue: 0,
                  activePurchaseOrders: 0,
                  completedOrders: 0,
                  averageLeadTime: 0,
                  onTimeDeliveryRate: 0
            };

            // Step 3: Get activity timeline (last 10 activities)
            const activity_set = await getLogActivities('supplier', supplierOid, 10);

            // Step 4: Combine all data
            const responseData = {
                  details: details,
                  stats: {
                        totalProducts: parseInt(stats.total_products) || 0,
                        totalPurchaseValue: parseFloat(stats.total_purchase_value) || 0,
                        activePurchaseOrders: parseInt(stats.active_orders) || 0,
                        completedOrders: parseInt(stats.completed_orders) || 0,
                        averageLeadTime: parseFloat(stats.average_lead_time) || 0,
                        onTimeDeliveryRate: parseFloat(stats.on_time_delivery_rate) || 0
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
            WITH supplier_products AS (
                  -- Get unique products purchased from this supplier
                  SELECT 
                        COUNT(DISTINCT pd.product_oid) as total_products
                  FROM ${TABLE.PURCHASE} p
                  INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.purchase_oid = p.oid
                  WHERE p.supplier_oid = $1
            ),
            purchase_stats AS (
                  -- Get purchase statistics
                  SELECT 
                        COUNT(*) as total_orders,
                        -- Active orders: Not completed/cancelled (assuming pending, in-progress, etc.)
                        COUNT(CASE 
                              WHEN p.cancelled_on IS NULL 
                              AND (p.verified_on IS NULL OR p.status NOT IN ('Completed', 'Cancelled', 'Verified'))
                              THEN 1 
                        END) as active_orders,
                        -- Completed orders: Has verified_on date or status is Completed/Verified
                        COUNT(CASE 
                              WHEN p.verified_on IS NOT NULL OR p.status IN ('Completed', 'Verified')
                              THEN 1 
                        END) as completed_orders,
                        ROUND(COALESCE(SUM(p.total_amount), 0)::numeric, 2) as total_purchase_value,
                        -- Average lead time: From order creation to verification (approximation)
                        ROUND(COALESCE(AVG(
                              CASE 
                                    WHEN p.verified_on IS NOT NULL AND p.created_on IS NOT NULL
                                    THEN EXTRACT(DAY FROM (p.verified_on - p.created_on))
                              END
                        ), 0)::numeric, 2) as avg_lead_time,
                        -- Completion rate as proxy for "on-time" (without expected dates, we can't calculate true on-time rate)
                        ROUND(COALESCE(
                              (COUNT(CASE WHEN p.verified_on IS NOT NULL OR p.status IN ('Completed', 'Verified') THEN 1 END) * 100.0 
                              / NULLIF(COUNT(CASE WHEN p.cancelled_on IS NULL THEN 1 END), 0))
                        , 0)::numeric, 2) as on_time_delivery_rate
                  FROM ${TABLE.PURCHASE} p
                  WHERE p.supplier_oid = $1
            )
            SELECT 
                  sp.total_products as total_products,
                  ps.total_purchase_value as total_purchase_value,
                  ps.active_orders as active_orders,
                  ps.completed_orders as completed_orders,
                  ps.avg_lead_time as average_lead_time,
                  ps.on_time_delivery_rate as on_time_delivery_rate
            FROM supplier_products sp
            CROSS JOIN purchase_stats ps
      `;
      return { text: query, values: [supplierOid] };
};

module.exports = get_supplier_details;