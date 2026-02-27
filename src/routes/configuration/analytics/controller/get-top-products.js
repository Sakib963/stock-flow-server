const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const {
  buildAnalyticsFilter,
  buildInventoryBaseQuery,
} = require("../utils/analytics-filters");

const get_top_products = async (request, res) => {
  try {
    const payload = request.body;
    const { type, id, dateFrom, dateTo, limit = 10 } = payload;

    log.info(
      `Fetching top products - Type: ${type || "all"}, ID: ${id || "N/A"}, Limit: ${limit}`,
    );

    const filter = buildAnalyticsFilter(type, id, dateFrom, dateTo);

    const query = `
            SELECT
                  p.oid,
                  p.name as product_name,
                  SUM(CAST(i.quantity_available AS INTEGER)) as stock,
                  ROUND(SUM(CAST(i.quantity_available AS NUMERIC) * CAST(COALESCE(i.selling_price, 0) AS NUMERIC)), 2) as value
            ${buildInventoryBaseQuery(filter.joins)}
            WHERE ${filter.whereConditions.join(" AND ")}
            GROUP BY p.oid, p.name
            ORDER BY stock DESC
            LIMIT $${filter.paramIndex}
      `;

    const values = [...filter.values, parseInt(limit)];
    const result = await get_data({ text: query, values });

    if (!result || result.length === 0) {
      return res.status(200).json({
        code: 200,
        message: "No data found",
        data: [],
      });
    }

    return res.status(200).json({
      code: 200,
      message: "Top products fetched successfully",
      data: result.map((row) => ({
        oid: row.oid,
        productName: row.product_name,
        stock: parseInt(row.stock) || 0,
        value: parseFloat(row.value) || 0,
      })),
    });
  } catch (e) {
    log.error(
      `An exception occurred while fetching top products: ${e?.message}`,
    );
    console.error(e);
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
    });
  }
};

module.exports = get_top_products;
