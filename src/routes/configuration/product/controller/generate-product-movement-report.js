const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const generate_product_movement_report = async (request, res) => {
  try {
    const payload = request.body;
    const productOid = payload.oid;

    if (!productOid) {
      log.warn("Product OID is required");
      return res.status(400).json({
        code: 400,
        message: "Product OID is required",
        data: null,
      });
    }

    // Get product details
    const productSql = generate_product_details_sql(productOid);
    const productData = await get_data(productSql);

    if (!productData || productData.length === 0) {
      log.info(`Product not found for OID: ${productOid}`);
      return res.status(404).json({
        code: 404,
        message: "Product not found",
        data: null,
      });
    }

    const productDetails = productData[0];

    // Get product statistics
    const statsSql = generate_stats_sql(productOid);
    const statsData = await get_data(statsSql);
    const stats = statsData.length ? statsData[0] : null;

    const buffer = await generate_movement_xlsx(productDetails, stats);
    const timestamp = Date.now();
    const file_name = `${productDetails.name.replace(/\s+/g, "_")}_movement_report_${timestamp}.xlsx`;
    const file_name_ascii = file_name.replace(/[^\x00-\x7F]/g, "");
    const file_name_encoded = encodeURIComponent(file_name);

    log.info(
      `Download movement report for product [${productDetails.name}] - [${file_name}]`,
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
      `An exception occurred while generating product movement report: ${e?.message}`,
    );
    console.error(e);
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
    });
  }
};

const generate_product_details_sql = (productOid) => {
  const query = `
            SELECT
                  p.oid,
                  p.name,
                  p.sku,
                  p.product_nature,
                  p.unit_type,
                  p.restock_threshold,
                  c.name as category_name,
                  sc.name as sub_category_name,
                  b.name as brand_name
            FROM ${TABLE.PRODUCT} p
            LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
            LEFT JOIN ${TABLE.SUB_CATEGORIES} sc ON sc.oid = p.sub_category_oid
            LEFT JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid
            WHERE p.oid = $1 AND p.is_deleted = FALSE`;

  return { text: query, values: [productOid] };
};

const generate_stats_sql = (productOid) => {
  const query = `
            SELECT
                  COALESCE(ps.total_sold, 0)::int as total_sold,
                  COALESCE(ps.total_returned, 0)::int as total_returned,
                  COALESCE(ps.total_damaged, 0)::int as total_damaged,
                  COALESCE(ps.total_wasted, 0)::int as total_wasted
            FROM ${TABLE.PRODUCT_STATS} ps
            WHERE ps.product_oid = $1`;

  return { text: query, values: [productOid] };
};

const generate_movement_xlsx = async (productDetails, stats) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Movement Report");

  // Add report header
  addReportHeader(sheet, `Product Movement Report - ${productDetails.name}`, 4);

  // Add product information section
  let currentRow = 5;
  sheet.addRow(["PRODUCT INFORMATION"]);
  sheet.getRow(currentRow).font = { bold: true, size: 14 };
  currentRow++;

  const productInfo = [
    ["Product Name:", productDetails.name],
    ["SKU:", productDetails.sku || "N/A"],
    ["Category:", productDetails.category_name || "N/A"],
    ["Sub Category:", productDetails.sub_category_name || "N/A"],
    ["Brand:", productDetails.brand_name || "N/A"],
    ["Product Nature:", productDetails.product_nature || "N/A"],
    ["Unit Type:", productDetails.unit_type || "N/A"],
    ["Restock Threshold:", productDetails.restock_threshold || 0],
  ];

  productInfo.forEach((info) => {
    sheet.addRow(info);
    sheet.getRow(currentRow).font = { bold: true };
    currentRow++;
  });

  // Add spacing
  sheet.addRow([]);
  currentRow++;

  // Add movement statistics section
  sheet.addRow(["MOVEMENT STATISTICS"]);
  sheet.getRow(currentRow).font = { bold: true, size: 14 };
  currentRow++;

  if (stats) {
    const movementStats = [
      ["Total Sold:", stats.total_sold || 0],
      ["Total Returned:", stats.total_returned || 0],
      ["Total Damaged:", stats.total_damaged || 0],
      ["Total Wasted:", stats.total_wasted || 0],
      ["", ""],
      ["Net Movement:", (stats.total_sold || 0) - (stats.total_returned || 0)],
      ["Total Loss:", (stats.total_damaged || 0) + (stats.total_wasted || 0)],
    ];

    movementStats.forEach((stat, index) => {
      sheet.addRow(stat);
      if (stat[0]) {
        sheet.getRow(currentRow).font = { bold: true };
      }
      if (index >= 5) {
        sheet.getRow(currentRow).font = {
          bold: true,
          color: { argb: "FF594ED1" },
        };
      }
      currentRow++;
    });
  } else {
    sheet.addRow(["No movement data available"]);
    currentRow++;
  }

  // Auto-size columns
  sheet.columns.forEach((col, index) => {
    if (index === 0) {
      col.width = 30;
    } else {
      col.width = 20;
    }
  });

  // Add borders and styling
  for (let i = 5; i <= currentRow; i++) {
    sheet.getRow(i).eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
  }

  return workbook.xlsx.writeBuffer();
};

module.exports = generate_product_movement_report;
