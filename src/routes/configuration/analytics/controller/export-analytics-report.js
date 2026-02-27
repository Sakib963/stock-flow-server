const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");
const {
  buildAnalyticsFilter,
  buildInventoryBaseQuery,
} = require("../utils/analytics-filters");

const export_analytics_report = async (request, res) => {
  try {
    const payload = request.body;
    const { type, id, name, dateFrom, dateTo } = payload;

    log.info(
      `Exporting comprehensive analytics report - Type: ${type || "all"}, ID: ${id || "N/A"}, Name: ${name || "N/A"}`,
    );

    const filter = buildAnalyticsFilter(type, id, dateFrom, dateTo);

    // Fetch ALL analytics data (matching UI)
    const metricsData = await getMetrics(filter);
    const stockTrendData = await getStockTrend(filter, dateFrom, dateTo);
    const valueTrendData = await getInventoryValueTrend(
      filter,
      dateFrom,
      dateTo,
    );
    const topProductsData = await getTopProducts(filter);
    const stockDistributionData = await getStockDistribution(filter);
    const performanceData = await getProductPerformance(filter); // ALL products
    const movementsData = await getStockMovements(
      filter,
      type,
      id,
      dateFrom,
      dateTo,
    );

    // Check if we have any meaningful data
    if (metricsData.total_products === 0 && performanceData.length === 0) {
      log.info(`No analytics data found for the given filters`);
      return res.status(404).json({
        code: 404,
        message: "No analytics data found for the given parameters",
        data: null,
      });
    }

    // Generate comprehensive Excel workbook
    const buffer = await generate_comprehensive_analytics_xlsx(
      metricsData,
      stockTrendData,
      valueTrendData,
      topProductsData,
      stockDistributionData,
      performanceData,
      movementsData,
      { type, name, dateFrom, dateTo },
    );

    const timestamp = Date.now();
    const reportName = name
      ? `${name.replace(/\s+/g, "_")}_comprehensive_analytics_${timestamp}.xlsx`
      : `comprehensive_analytics_report_${timestamp}.xlsx`;
    const file_name_ascii = reportName.replace(/[^\x00-\x7F]/g, "");
    const file_name_encoded = encodeURIComponent(reportName);

    log.info(
      `Comprehensive analytics report generated successfully - ${reportName}`,
    );

    res
      .set(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .set(
        "Content-Disposition",
        `attachment; filename="${file_name_ascii}"; filename*=UTF-8''${file_name_encoded}`,
      )
      .set("X-Filename", file_name_encoded)
      .set("Access-Control-Expose-Headers", "X-Filename")
      .set("Content-Length", buffer.length)
      .send(buffer);
  } catch (e) {
    log.error(
      `An exception occurred while exporting analytics report: ${e?.message}`,
    );
    console.error(e);
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
    });
  }
};

const getMetrics = async (filter) => {
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
                    SUM(CAST(quantity_available AS INTEGER) * CAST(COALESCE(selling_price, 0) AS NUMERIC)) as product_value,
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
  return (
    result[0] || {
      total_products: 0,
      total_stock: 0,
      total_inventory_value: 0,
      avg_turnover_rate: 0,
    }
  );
};

const getProductPerformance = async (filter) => {
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
              ) as turnover_rate,
              c.name as category_name,
              s.name as sub_category_name,
              b.name as brand_name
        ${buildInventoryBaseQuery(filter.joins)}
        LEFT JOIN product_stats ps ON ps.product_oid = p.oid
        WHERE ${filter.whereConditions.join(" AND ")}
        GROUP BY p.oid, p.name, p.sku, p.restock_threshold, c.name, s.name, b.name
        ORDER BY stock DESC
  `;

  return await get_data({ text: query, values: filter.values });
};

const getStockMovements = async (filter, type, id, dateFrom, dateTo) => {
  let movementWhere = ["1=1"];
  let movementValues = [];
  let paramIndex = 1;

  if (type && type !== "all" && id) {
    switch (type) {
      case "category":
        movementWhere.push(`p.category_oid = $${paramIndex++}`);
        movementValues.push(id);
        break;
      case "sub-category":
        movementWhere.push(`p.sub_category_oid = $${paramIndex++}`);
        movementValues.push(id);
        break;
      case "brand":
        movementWhere.push(`p.brand_oid = $${paramIndex++}`);
        movementValues.push(id);
        break;
      case "product":
        movementWhere.push(`p.oid = $${paramIndex++}`);
        movementValues.push(id);
        break;
      case "warehouse":
        movementWhere.push(`pd.warehouse_oid = $${paramIndex++}`);
        movementValues.push(id);
        break;
    }
  }

  if (dateFrom) {
    movementWhere.push(`la.performed_on >= $${paramIndex++}`);
    movementValues.push(dateFrom);
  }
  if (dateTo) {
    movementWhere.push(
      `la.performed_on <= $${paramIndex++}::date + interval '1 day'`,
    );
    movementValues.push(dateTo);
  }

  const query = `
        SELECT
              la.performed_on as date,
              CASE
                    WHEN la.reference_type = 'purchase' THEN 'Purchase'
                    WHEN la.reference_type = 'product-return' THEN 'Return'
                    WHEN la.reference_type = 'product-dispose' THEN 'Dispose'
                    WHEN la.reference_type = 'transfer' THEN 'Transfer'
                    ELSE 'Other'
              END as type,
              p.name as product_name,
              la.title as reference_no,
              COALESCE(la.description, '') as notes
        FROM ${TABLE.ACTIVITY_LOG} la
        INNER JOIN ${TABLE.PRODUCT} p ON la.reference_oid = p.oid
        LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.product_oid = p.oid
        WHERE la.reference_type IN ('purchase', 'product-return', 'product-dispose', 'transfer')
        AND ${movementWhere.join(" AND ")}
        ORDER BY la.performed_on DESC
  `;

  return await get_data({ text: query, values: movementValues });
};

const getStockTrend = async (filter, dateFrom, dateTo) => {
  let dateFormat = "YYYY-MM";
  if (dateFrom && dateTo) {
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 31) {
      dateFormat = "YYYY-MM-DD";
    } else if (daysDiff <= 90) {
      dateFormat = "IYYY-IW";
    }
  }

  const query = `
        SELECT
              TO_CHAR(i.created_on, '${dateFormat}') as period,
              SUM(CAST(i.quantity_available AS INTEGER)) as stock
        ${buildInventoryBaseQuery(filter.joins)}
        WHERE ${filter.whereConditions.join(" AND ")}
        GROUP BY period
        ORDER BY period ASC
  `;

  return await get_data({ text: query, values: filter.values });
};

const getInventoryValueTrend = async (filter, dateFrom, dateTo) => {
  let dateFormat = "YYYY-MM";
  if (dateFrom && dateTo) {
    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 31) {
      dateFormat = "YYYY-MM-DD";
    } else if (daysDiff <= 90) {
      dateFormat = "IYYY-IW";
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

  return await get_data({ text: query, values: filter.values });
};

const getTopProducts = async (filter) => {
  const query = `
        SELECT
              p.oid,
              p.name as product_name,
              p.sku,
              SUM(CAST(i.quantity_available AS INTEGER)) as stock,
              ROUND(SUM(CAST(i.quantity_available AS NUMERIC) * CAST(COALESCE(i.selling_price, 0) AS NUMERIC)), 2) as value,
              c.name as category_name,
              b.name as brand_name
        ${buildInventoryBaseQuery(filter.joins)}
        WHERE ${filter.whereConditions.join(" AND ")}
        GROUP BY p.oid, p.name, p.sku, c.name, b.name
        ORDER BY stock DESC
        LIMIT 20
  `;

  return await get_data({ text: query, values: filter.values });
};

const getStockDistribution = async (filter) => {
  const query = `
        SELECT
              p.oid,
              p.name as product_name,
              SUM(CAST(i.quantity_available AS INTEGER)) as stock,
              ROUND((SUM(CAST(i.quantity_available AS INTEGER))::NUMERIC / NULLIF((
                SELECT SUM(CAST(quantity_available AS INTEGER))
                FROM inventory i2
                INNER JOIN product p2 ON p2.oid = i2.product_oid
                WHERE p2.is_deleted = FALSE
              ), 0) * 100), 2) as percentage
        ${buildInventoryBaseQuery(filter.joins)}
        WHERE ${filter.whereConditions.join(" AND ")}
        GROUP BY p.oid, p.name
        HAVING SUM(CAST(i.quantity_available AS INTEGER)) > 0
        ORDER BY stock DESC
        LIMIT 50
  `;

  return await get_data({ text: query, values: filter.values });
};

const generate_comprehensive_analytics_xlsx = async (
  metrics,
  stockTrend,
  valueTrend,
  topProducts,
  distribution,
  performance,
  movements,
  filterInfo,
) => {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Executive Summary
  const summarySheet = workbook.addWorksheet("Executive Summary");
  const summaryTitle = filterInfo.name
    ? `Analytics Report - ${filterInfo.name}`
    : "Analytics Report - Overall";
  addReportHeader(summarySheet, summaryTitle, 2);

  summarySheet.addRow(["ANALYTICS SUMMARY"]);
  summarySheet.getRow(5).font = {
    bold: true,
    size: 14,
    color: { argb: "FF0066CC" },
  };
  summarySheet.addRow([]);

  if (filterInfo.dateFrom || filterInfo.dateTo) {
    summarySheet.addRow([
      "Report Period:",
      `${filterInfo.dateFrom || "Beginning"} to ${filterInfo.dateTo || "Present"}`,
    ]);
    summarySheet.getRow(summarySheet.rowCount).font = { bold: true };
  }

  summarySheet.addRow(["Filter Type:", filterInfo.type || "Overall"]);
  summarySheet.addRow(["Filter Name:", filterInfo.name || "All"]);
  summarySheet.addRow(["Generated On:", new Date().toLocaleString()]);
  summarySheet.addRow([]);

  summarySheet.addRow(["KEY PERFORMANCE METRICS"]);
  summarySheet.getRow(summarySheet.rowCount).font = {
    bold: true,
    size: 12,
    color: { argb: "FF0066CC" },
  };
  summarySheet.addRow(["Total Products:", metrics.total_products]);
  summarySheet.addRow(["Total Stock Units:", metrics.total_stock]);
  summarySheet.addRow([
    "Total Inventory Value:",
    `$${parseFloat(metrics.total_inventory_value).toFixed(2)}`,
  ]);
  summarySheet.addRow([
    "Average Turnover Rate:",
    `${parseFloat(metrics.avg_turnover_rate).toFixed(2)}%`,
  ]);

  summarySheet.addRow([]);
  summarySheet.addRow(["INSIGHTS"]);
  summarySheet.getRow(summarySheet.rowCount).font = { bold: true, size: 12 };

  const highTurnover = performance.filter(
    (p) => parseFloat(p.turnover_rate) > 70,
  ).length;
  const lowStock = performance.filter(
    (p) => parseInt(p.stock) < parseInt(p.min_stock),
  ).length;

  summarySheet.addRow(["High Turnover Products (>70%):", highTurnover]);
  summarySheet.addRow(["Low Stock Products (Below Min):", lowStock]);
  summarySheet.addRow(["Total Product Categories:", topProducts.length]);

  summarySheet.columns = [{ width: 35 }, { width: 35 }];

  // Sheet 2: Stock Level Trends
  if (stockTrend && stockTrend.length > 0) {
    const trendSheet = workbook.addWorksheet("Stock Level Trends");
    addReportHeader(trendSheet, "Stock Level Over Time", 2);

    const trendTitles = ["Period", "Total Stock Units"];
    trendSheet.addRow(trendTitles);
    trendSheet.getRow(5).font = { bold: true, size: 11 };

    stockTrend.forEach((item) => {
      trendSheet.addRow([item.period, parseInt(item.stock)]);
    });

    // Calculate trend
    const firstStock = parseInt(stockTrend[0]?.stock || 0);
    const lastStock = parseInt(stockTrend[stockTrend.length - 1]?.stock || 0);
    const change = lastStock - firstStock;
    const percentChange =
      firstStock > 0 ? ((change / firstStock) * 100).toFixed(2) : 0;

    trendSheet.addRow([]);
    trendSheet.addRow(["TREND ANALYSIS"]);
    trendSheet.getRow(trendSheet.rowCount).font = { bold: true };
    trendSheet.addRow(["Initial Stock:", firstStock]);
    trendSheet.addRow(["Current Stock:", lastStock]);
    trendSheet.addRow(["Change:", change]);
    trendSheet.addRow(["% Change:", `${percentChange}%`]);

    trendSheet.columns = [{ width: 20 }, { width: 20 }];
  }

  // Sheet 3: Inventory Value Trends
  if (valueTrend && valueTrend.length > 0) {
    const valueSheet = workbook.addWorksheet("Inventory Value Trends");
    addReportHeader(valueSheet, "Inventory Value Over Time", 2);

    const valueTitles = ["Period", "Total Value ($)"];
    valueSheet.addRow(valueTitles);
    valueSheet.getRow(5).font = { bold: true, size: 11 };

    valueTrend.forEach((item) => {
      valueSheet.addRow([item.period, parseFloat(item.value).toFixed(2)]);
    });

    // Calculate value trend
    const firstValue = parseFloat(valueTrend[0]?.value || 0);
    const lastValue = parseFloat(valueTrend[valueTrend.length - 1]?.value || 0);
    const valueChange = lastValue - firstValue;
    const valuePercentChange =
      firstValue > 0 ? ((valueChange / firstValue) * 100).toFixed(2) : 0;

    valueSheet.addRow([]);
    valueSheet.addRow(["VALUE ANALYSIS"]);
    valueSheet.getRow(valueSheet.rowCount).font = { bold: true };
    valueSheet.addRow(["Initial Value:", `$${firstValue.toFixed(2)}`]);
    valueSheet.addRow(["Current Value:", `$${lastValue.toFixed(2)}`]);
    valueSheet.addRow(["Change:", `$${valueChange.toFixed(2)}`]);
    valueSheet.addRow(["% Change:", `${valuePercentChange}%`]);

    valueSheet.columns = [{ width: 20 }, { width: 20 }];
  }

  // Sheet 4: Top Products
  if (topProducts && topProducts.length > 0) {
    const topSheet = workbook.addWorksheet("Top Products");
    addReportHeader(topSheet, "Top Products by Stock Level", 7);

    const topTitles = [
      "Rank",
      "Product Name",
      "SKU",
      "Category",
      "Brand",
      "Stock Units",
      "Value ($)",
    ];

    topSheet.addRow(topTitles);
    topSheet.getRow(5).font = { bold: true, size: 11 };

    let rank = 1;
    let totalTopStock = 0;
    let totalTopValue = 0;

    topProducts.forEach((item) => {
      totalTopStock += parseInt(item.stock || 0);
      totalTopValue += parseFloat(item.value || 0);

      topSheet.addRow([
        rank++,
        item.product_name,
        item.sku || "N/A",
        item.category_name || "N/A",
        item.brand_name || "N/A",
        parseInt(item.stock),
        parseFloat(item.value).toFixed(2),
      ]);
    });

    topSheet.addRow([]);
    topSheet.addRow([
      "TOTALS",
      "",
      "",
      "",
      "",
      totalTopStock,
      totalTopValue.toFixed(2),
    ]);
    topSheet.getRow(topSheet.rowCount).font = { bold: true };

    topSheet.columns.forEach((col, idx) => {
      if (idx === 0) col.width = 8;
      else if (idx === 1) col.width = 30;
      else col.width = 15;
    });
  }

  // Sheet 5: Stock Distribution
  if (distribution && distribution.length > 0) {
    const distSheet = workbook.addWorksheet("Stock Distribution");
    addReportHeader(distSheet, "Stock Distribution Analysis", 3);

    const distTitles = ["Product Name", "Stock Units", "Percentage of Total"];

    distSheet.addRow(distTitles);
    distSheet.getRow(5).font = { bold: true, size: 11 };

    let totalDistStock = 0;
    distribution.forEach((item) => {
      totalDistStock += parseInt(item.stock || 0);
      distSheet.addRow([
        item.product_name,
        parseInt(item.stock),
        `${parseFloat(item.percentage).toFixed(2)}%`,
      ]);
    });

    distSheet.addRow([]);
    distSheet.addRow(["TOTAL", totalDistStock, "100.00%"]);
    distSheet.getRow(distSheet.rowCount).font = { bold: true };

    distSheet.columns = [{ width: 35 }, { width: 15 }, { width: 20 }];
  }

  // Sheet 6: Product Performance (Complete)
  const perfSheet = workbook.addWorksheet("Product Performance");
  addReportHeader(perfSheet, "Complete Product Performance Analysis", 11);

  const perfTitles = [
    "Product Name",
    "SKU",
    "Category",
    "Sub Category",
    "Brand",
    "Stock",
    "Min Stock",
    "Value ($)",
    "Sold",
    "Returned",
    "Disposed",
    "Turnover Rate",
  ];

  perfSheet.addRow(perfTitles);
  perfSheet.getRow(5).font = { bold: true, size: 11 };

  let totalValue = 0;
  let totalStock = 0;
  let totalSold = 0;
  let totalReturned = 0;
  let totalDisposed = 0;

  performance.forEach((item) => {
    totalValue += parseFloat(item.value || 0);
    totalStock += parseInt(item.stock || 0);
    totalSold += parseInt(item.total_sold || 0);
    totalReturned += parseInt(item.total_returned || 0);
    totalDisposed += parseInt(item.total_disposed || 0);

    perfSheet.addRow([
      item.product_name,
      item.sku || "N/A",
      item.category_name || "N/A",
      item.sub_category_name || "N/A",
      item.brand_name || "N/A",
      parseInt(item.stock),
      parseInt(item.min_stock),
      parseFloat(item.value).toFixed(2),
      parseInt(item.total_sold),
      parseInt(item.total_returned),
      parseInt(item.total_disposed),
      `${parseFloat(item.turnover_rate).toFixed(2)}%`,
    ]);
  });

  perfSheet.addRow([]);
  perfSheet.addRow([
    "TOTALS",
    "",
    "",
    "",
    "",
    totalStock,
    "",
    totalValue.toFixed(2),
    totalSold,
    totalReturned,
    totalDisposed,
    "",
  ]);
  perfSheet.getRow(perfSheet.rowCount).font = { bold: true };

  perfSheet.columns.forEach((col, idx) => {
    if (idx === 0) col.width = 30;
    else if (idx <= 4) col.width = 18;
    else col.width = 12;
  });

  // Sheet 7: Stock Movements (Complete)
  if (movements && movements.length > 0) {
    const movSheet = workbook.addWorksheet("Stock Movements");
    addReportHeader(movSheet, "Complete Stock Movement History", 5);

    const movTitles = ["Date", "Type", "Product", "Reference No", "Notes"];

    movSheet.addRow(movTitles);
    movSheet.getRow(5).font = { bold: true, size: 11 };

    const movementCounts = {
      Purchase: 0,
      Return: 0,
      Dispose: 0,
      Transfer: 0,
      Other: 0,
    };

    movements.forEach((mov) => {
      movementCounts[mov.type] = (movementCounts[mov.type] || 0) + 1;

      movSheet.addRow([
        new Date(mov.date).toLocaleDateString(),
        mov.type,
        mov.product_name,
        mov.reference_no || "N/A",
        mov.notes || "",
      ]);
    });

    movSheet.addRow([]);
    movSheet.addRow(["MOVEMENT SUMMARY"]);
    movSheet.getRow(movSheet.rowCount).font = { bold: true };

    Object.entries(movementCounts).forEach(([type, count]) => {
      if (count > 0) {
        movSheet.addRow([type, count]);
      }
    });

    movSheet.columns = [
      { width: 15 },
      { width: 12 },
      { width: 30 },
      { width: 20 },
      { width: 40 },
    ];
  }

  return workbook.xlsx.writeBuffer();
};

module.exports = export_analytics_report;
