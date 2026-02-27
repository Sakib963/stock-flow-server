const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const {
  buildAnalyticsFilter,
  buildInventoryBaseQuery,
} = require("../utils/analytics-filters");

const get_inventory_value_trend = async (request, res) => {
  try {
    const payload = request.body;
    const { type, id, dateFrom, dateTo } = payload;

    log.info(
      `Fetching inventory value trend - Type: ${type || "all"}, ID: ${id || "N/A"}`,
    );

    const filter = buildAnalyticsFilter(type, id, dateFrom, dateTo);

    // Determine grouping based on date range
    let dateFormat = "YYYY-MM"; // Default to monthly
    if (dateFrom && dateTo) {
      const start = new Date(dateFrom);
      const end = new Date(dateTo);
      const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

      if (daysDiff <= 31) {
        dateFormat = "YYYY-MM-DD"; // Daily for up to 1 month
      } else if (daysDiff <= 90) {
        dateFormat = "IYYY-IW"; // Weekly for up to 3 months
      }
    }

    const query = `
            SELECT
                  TO_CHAR(i.created_on, '${dateFormat}') as period,
                  ROUND(SUM(CAST(i.quantity_available AS NUMERIC) * CAST(COALESCE(i.selling_price, 0) AS NUMERIC)), 2) as value
            ${buildInventoryBaseQuery(filter.joins)}
            WHERE ${filter.whereConditions.join(" AND ")}
            GROUP BY period
            ORDER BY period ASC
      `;

    const result = await get_data({ text: query, values: filter.values });

    if (!result || result.length === 0) {
      return res.status(200).json({
        code: 200,
        message: "No data found",
        data: [],
      });
    }

    return res.status(200).json({
      code: 200,
      message: "Inventory value trend fetched successfully",
      data: result.map((row) => ({
        period: row.period,
        value: parseFloat(row.value) || 0,
      })),
    });
  } catch (e) {
    log.error(
      `An exception occurred while fetching inventory value trend: ${e?.message}`,
    );
    console.error(e);
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
    });
  }
};

module.exports = get_inventory_value_trend;
