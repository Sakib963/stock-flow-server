const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const {
  buildAnalyticsFilter,
  buildInventoryBaseQuery,
} = require("../utils/analytics-filters");

const get_analytics_metrics = async (request, res) => {
  try {
    const payload = request.body;
    const { type, id, dateFrom, dateTo } = payload;

    log.info(
      `Fetching analytics metrics - Type: ${type || "all"}, ID: ${id || "N/A"}, Date: ${dateFrom || "N/A"} to ${dateTo || "N/A"}`,
    );

    const filter = buildAnalyticsFilter(type, id, dateFrom, dateTo);

    // Query to get overall metrics
    const query = `
            WITH filtered_inventory AS (
                  SELECT
                        i.oid,
                        i.product_oid,
                        i.quantity_available,
                        i.selling_price,
                        i.cost_price,
                        p.restock_threshold,
                        ps.total_sold,
                        ps.total_returned
                  ${buildInventoryBaseQuery(filter.joins)}
                  LEFT JOIN product_stats ps ON ps.product_oid = p.oid
                  WHERE ${filter.whereConditions.join(" AND ")}
            ),
            product_aggregates AS (
                  SELECT
                        product_oid,
                        SUM(CAST(quantity_available AS INTEGER)) as total_stock,
                    SUM(CAST(quantity_available AS INTEGER) * CAST(COALESCE(selling_price, cost_price, 0) AS NUMERIC)) as product_value,
                        MAX(restock_threshold) as min_stock,
                        MAX(total_sold) as sold,
                        MAX(total_returned) as returned
                  FROM filtered_inventory
                  GROUP BY product_oid
            )
            SELECT
                  COUNT(DISTINCT product_oid) as total_products,
                  COALESCE(SUM(total_stock), 0) as total_stock,
                  COALESCE(ROUND(SUM(product_value), 2), 0) as total_inventory_value,
                  COALESCE(
                        ROUND(
                              AVG(
                                    CASE
                                          WHEN (sold + returned) > 0
                                          THEN (sold::NUMERIC / (sold + returned) * 100)
                                          ELSE 0
                                    END
                              ),
                              2
                        ),
                        0
                  ) as avg_turnover_rate
            FROM product_aggregates
      `;

    const result = await get_data({ text: query, values: filter.values });

    if (!result || result.length === 0) {
      return res.status(200).json({
        code: 200,
        message: "No data found",
        data: {
          totalProducts: 0,
          totalInventoryValue: 0,
          totalStock: 0,
          avgTurnoverRate: 0,
        },
      });
    }

    const metrics = result[0];

    return res.status(200).json({
      code: 200,
      message: "Analytics metrics fetched successfully",
      data: {
        totalProducts: parseInt(metrics.total_products) || 0,
        totalInventoryValue: parseFloat(metrics.total_inventory_value) || 0,
        totalStock: parseInt(metrics.total_stock) || 0,
        avgTurnoverRate: parseFloat(metrics.avg_turnover_rate) || 0,
      },
    });
  } catch (e) {
    log.error(
      `An exception occurred while fetching analytics metrics: ${e?.message}`,
    );
    console.error(e);
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
    });
  }
};

module.exports = get_analytics_metrics;
