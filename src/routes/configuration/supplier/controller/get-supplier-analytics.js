const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");

const get_supplier_analytics = async (request, res) => {
      try {
            const supplierOid = request.params.oid;

            // Get verification analytics
            const verificationSql = generate_verification_analytics_sql(supplierOid);
            const verification_data = await get_data(verificationSql);
            const verification = verification_data.length ? verification_data[0] : null;

            // Get profit analytics
            const profitSql = generate_profit_analytics_sql(supplierOid);
            const profit_data = await get_data(profitSql);
            
            // Get top performing products
            const topProductsSql = generate_top_products_sql(supplierOid);
            const top_products = await get_data(topProductsSql);

            // Get demand trend (sales over time)
            const demandTrendSql = generate_demand_trend_sql(supplierOid);
            const demand_trend = await get_data(demandTrendSql);

            const responseData = {
                  verification: {
                        totalQuantityOrdered: parseInt(verification?.total_ordered_qty || 0),
                        totalQuantityReceived: parseInt(verification?.total_verified_qty || 0),
                        receivedPercentage: parseFloat(verification?.verification_rate || 0),
                        totalOrderedAmount: parseFloat(verification?.ordered_value || 0),
                        totalReceivedAmount: parseFloat(verification?.verified_value || 0),
                        costDifference: parseFloat(verification?.cost_variance || 0)
                  },
                  profitability: profit_data.map(p => ({
                        productName: p.product_name,
                        quantitySuppliedByThisSupplier: parseInt(p.supplier_quantity || 0),
                        totalQuantitySoldAllSuppliers: parseInt(p.total_quantity_sold || 0),
                        avgPurchasePriceFromThisSupplier: parseFloat(p.avg_purchase_price || 0),
                        avgCurrentSellingPrice: parseFloat(p.avg_selling_price || 0),
                        profitPerUnit: parseFloat(p.unit_profit || 0),
                        markupPercentage: parseFloat(p.profit_margin_pct || 0),
                        estimatedTotalProfitFromThisSupplier: parseFloat(p.estimated_total_profit || 0)
                  })),
                  topProducts: top_products.map(p => ({
                        productName: p.product_name,
                        totalQuantitySoldAllSuppliers: parseInt(p.total_quantity_sold || 0),
                        quantitySuppliedByThisSupplier: parseInt(p.supplier_quantity || 0),
                        avgCurrentSellingPrice: parseFloat(p.avg_selling_price || 0),
                        avgPurchasePriceFromThisSupplier: parseFloat(p.avg_purchase_price || 0),
                        estimatedRevenueFromThisSupplier: parseFloat(p.estimated_revenue || 0),
                        estimatedProfitFromThisSupplier: parseFloat(p.estimated_profit || 0)
                  })),
                  demandTrend: demand_trend.map(d => ({
                        monthYear: d.month,
                        totalQuantitySold: parseInt(d.sold_qty || 0),
                        totalRevenue: parseFloat(d.revenue || 0)
                  }))
            };

            log.info(`Supplier analytics retrieved for oid: ${supplierOid}`);
            return res.status(200).json({
                  code: 200,
                  message: "Supplier analytics retrieved successfully",
                  data: responseData,
            });
      } catch (e) {
            log.error(`An exception occurred while getting supplier analytics: ${e?.message}`);
            console.error(e);
            return res.status(500).json({ 
                  code: 500, 
                  message: "Something went wrong! Please try again later!" 
            });
      }
};

const generate_verification_analytics_sql = (supplierOid) => {
      const query = `
            SELECT 
                  SUM(pd.ordered_quantity) as total_ordered_qty,
                  SUM(COALESCE(pd.verified_quantity, 0)) as total_verified_qty,
                  ROUND((SUM(COALESCE(pd.verified_quantity, 0))::numeric / NULLIF(SUM(pd.ordered_quantity), 0) * 100), 2) as verification_rate,
                  ROUND(SUM(pd.ordered_quantity * pd.ordered_unit_price)::numeric, 2) as ordered_value,
                  ROUND(SUM(COALESCE(pd.verified_quantity, 0) * COALESCE(pd.verified_unit_price, pd.ordered_unit_price))::numeric, 2) as verified_value,
                  ROUND((SUM(pd.ordered_quantity * pd.ordered_unit_price) - SUM(COALESCE(pd.verified_quantity, 0) * COALESCE(pd.verified_unit_price, pd.ordered_unit_price)))::numeric, 2) as cost_variance
            FROM ${TABLE.PURCHASE} p
            INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.purchase_oid = p.oid
            WHERE p.supplier_oid = $1
      `;
      return { text: query, values: [supplierOid] };
};

const generate_profit_analytics_sql = (supplierOid) => {
      const query = `
            SELECT 
                  pr.name AS product_name,
                  SUM(COALESCE(pd.verified_quantity, pd.ordered_quantity)) as supplier_quantity,
                  COALESCE(ps.total_sold, 0) AS total_quantity_sold,
                  ROUND(COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price))::numeric, 2) as avg_purchase_price,
                  ROUND(COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0), 2) AS avg_selling_price,
                  ROUND(COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0) - COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price)), 2) as unit_profit,
                  ROUND((COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0) - COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price))) * 100.0 / NULLIF(COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price)), 0), 2) as profit_margin_pct,
                  ROUND(SUM(COALESCE(pd.verified_quantity, pd.ordered_quantity)) * (COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0) - COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price))), 2) as estimated_total_profit
            FROM ${TABLE.PURCHASE} p
            INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.purchase_oid = p.oid
            INNER JOIN ${TABLE.PRODUCT} pr ON pr.oid = pd.product_oid
            LEFT JOIN ${TABLE.INVENTORY} i ON i.product_oid = pr.oid AND i.status IN ('ready_for_sale', 'pending_pricing')
            LEFT JOIN ${TABLE.PRODUCT_STATS} ps ON ps.product_oid = pr.oid
            WHERE p.supplier_oid = $1 AND pr.is_deleted = FALSE
            GROUP BY pr.name, ps.total_sold
            HAVING COALESCE(ps.total_sold, 0) > 0
            ORDER BY estimated_total_profit DESC
            LIMIT 5
      `;
      return { text: query, values: [supplierOid] };
};

const generate_top_products_sql = (supplierOid) => {
      const query = `
            SELECT 
                  pr.name AS product_name,
                  COALESCE(ps.total_sold, 0) AS total_quantity_sold,
                  SUM(COALESCE(pd.verified_quantity, pd.ordered_quantity)) as supplier_quantity,
                  ROUND(COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0), 2) as avg_selling_price,
                  ROUND(COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price)), 2) as avg_purchase_price,
                  ROUND(SUM(COALESCE(pd.verified_quantity, pd.ordered_quantity)) * COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0), 2) as estimated_revenue,
                  ROUND(SUM(COALESCE(pd.verified_quantity, pd.ordered_quantity)) * (COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0) - COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price))), 2) as estimated_profit
            FROM ${TABLE.PURCHASE} p
            INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.purchase_oid = p.oid
            INNER JOIN ${TABLE.PRODUCT} pr ON pr.oid = pd.product_oid
            LEFT JOIN ${TABLE.INVENTORY} i ON i.product_oid = pr.oid AND i.status IN ('ready_for_sale', 'pending_pricing')
            LEFT JOIN ${TABLE.PRODUCT_STATS} ps ON ps.product_oid = pr.oid
            WHERE p.supplier_oid = $1 AND pr.is_deleted = FALSE
            GROUP BY pr.name, ps.total_sold
            HAVING COALESCE(ps.total_sold, 0) > 0
            ORDER BY total_quantity_sold DESC
            LIMIT 5
      `;
      return { text: query, values: [supplierOid] };
};

const generate_demand_trend_sql = (supplierOid) => {
      const query = `
            SELECT 
                  TO_CHAR(s.created_on, 'YYYY-MM') as month,
                  SUM(sd.quantity) as sold_qty,
                  ROUND(SUM(sd.quantity * sd.unit_price)::numeric, 2) as revenue
            FROM ${TABLE.PURCHASE} p
            INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.purchase_oid = p.oid
            INNER JOIN ${TABLE.PRODUCT} pr ON pr.oid = pd.product_oid
            INNER JOIN ${TABLE.SALE_DETAILS} sd ON sd.product_oid = pr.oid
            INNER JOIN ${TABLE.SALES} s ON s.oid = sd.order_oid
            WHERE p.supplier_oid = $1 
                  AND s.created_on >= CURRENT_DATE - INTERVAL '12 months'
                  AND pr.is_deleted = FALSE
            GROUP BY TO_CHAR(s.created_on, 'YYYY-MM')
            ORDER BY month DESC
            LIMIT 12
      `;
      return { text: query, values: [supplierOid] };
};

module.exports = get_supplier_analytics;
