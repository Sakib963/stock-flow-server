const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const {
  buildAnalyticsFilter,
  buildInventoryBaseQuery,
} = require("../utils/analytics-filters");

const get_product_performance = async (request, res) => {
  try {
    const payload = request.body;
    const { type, id, dateFrom, dateTo, page = 1, pageSize = 10 } = payload;

    log.info(
      `Fetching product performance - Type: ${type || "all"}, ID: ${id || "N/A"}, Page: ${page}`,
    );

    const filter = buildAnalyticsFilter(type, id, dateFrom, dateTo);

    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    // Count total products
    const countQuery = `
            SELECT COUNT(DISTINCT p.oid) as total
            ${buildInventoryBaseQuery(filter.joins)}
            WHERE ${filter.whereConditions.join(" AND ")}
      `;

    const countResult = await get_data({
      text: countQuery,
      values: filter.values,
    });
    const total = parseInt(countResult[0]?.total || 0);

    // Get paginated product performance
    const query = `
            SELECT
                  p.oid,
                  p.name as product_name,
                  p.sku,
                  p.restock_threshold as min_stock,
                  SUM(CAST(i.quantity_available AS INTEGER)) as stock,
                  ROUND(SUM(CAST(i.quantity_available AS NUMERIC) * CAST(COALESCE(i.selling_price, 0) AS NUMERIC)), 2) as value,
                  COALESCE(MAX(ps.total_sold), 0) as total_sold,
                  COALESCE(MAX(ps.total_returned), 0) as total_returned,
                  COALESCE(MAX(ps.total_damaged) + MAX(ps.total_wasted), 0) as total_disposed,
                  COALESCE(
                        ROUND(
                              CASE
                                    WHEN (MAX(ps.total_sold) + MAX(ps.total_returned)) > 0
                                    THEN (MAX(ps.total_sold)::NUMERIC / (MAX(ps.total_sold) + MAX(ps.total_returned)) * 100)
                                    ELSE 0
                              END,
                              2
                        ),
                        0
                  ) as turnover_rate
            ${buildInventoryBaseQuery(filter.joins)}
            LEFT JOIN product_stats ps ON ps.product_oid = p.oid
            WHERE ${filter.whereConditions.join(" AND ")}
            GROUP BY p.oid, p.name, p.sku, p.restock_threshold
            ORDER BY stock DESC
            LIMIT $${filter.paramIndex} OFFSET $${filter.paramIndex + 1}
      `;

    const values = [...filter.values, parseInt(pageSize), offset];
    const result = await get_data({ text: query, values });

    if (!result || result.length === 0) {
      return res.status(200).json({
        code: 200,
        message: "No data found",
        data: {
          items: [],
          total: 0,
          page: parseInt(page),
          pageSize: parseInt(pageSize),
        },
      });
    }

    return res.status(200).json({
      code: 200,
      message: "Product performance fetched successfully",
      data: {
        items: result.map((row) => ({
          oid: row.oid,
          productName: row.product_name,
          sku: row.sku || "N/A",
          stock: parseInt(row.stock) || 0,
          minStock: parseInt(row.min_stock) || 0,
          value: parseFloat(row.value) || 0,
          totalSold: parseInt(row.total_sold) || 0,
          totalReturned: parseInt(row.total_returned) || 0,
          totalDisposed: parseInt(row.total_disposed) || 0,
          turnoverRate: parseFloat(row.turnover_rate) || 0,
        })),
        total,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
      },
    });
  } catch (e) {
    log.error(
      `An exception occurred while fetching product performance: ${e?.message}`,
    );
    console.error(e);
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
    });
  }
};

module.exports = get_product_performance;
