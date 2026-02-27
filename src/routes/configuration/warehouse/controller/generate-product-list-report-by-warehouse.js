const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const generate_product_list_report_by_warehouse = async (request, res) => {
  try {
    const payload = request.body;
    const warehouseOid = payload.oid;

    if (!warehouseOid) {
      log.warn("Warehouse OID is required");
      return res.status(400).json({
        code: 400,
        message: "Warehouse OID is required",
        data: null,
      });
    }

    // Get products with warehouse details in a single query
    const productsSql = generate_products_sql(warehouseOid);
    const products = await get_data(productsSql);

    if (!products || products.length === 0) {
      log.info(`No products found for warehouse OID: ${warehouseOid}`);
      return res.status(404).json({
        code: 404,
        message: "No products found for this warehouse",
        data: null,
      });
    }

    // Extract warehouse details from first row (same for all products)
    const warehouseDetails = {
      name: products[0].warehouse_name,
      code: products[0].warehouse_code,
      location: products[0].warehouse_location,
      status: products[0].warehouse_status,
    };

    const buffer = await generate_products_xlsx(products, warehouseDetails);
    const timestamp = Date.now();
    const file_name = `${warehouseDetails.name.replace(/\s+/g, "_")}_products_${timestamp}.xlsx`;
    // Create ASCII-safe fallback filename by removing non-ASCII characters
    const file_name_ascii = file_name.replace(/[^\x00-\x7F]/g, "");
    // Encode filename for RFC 5987 (UTF-8 support in headers)
    const file_name_encoded = encodeURIComponent(file_name);

    log.info(
      `Download products list for warehouse [${warehouseDetails.name}] - [${file_name}]`,
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
      `An exception occurred while generating product list: ${e?.message}`,
    );
    console.error(e);
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
    });
  }
};

const generate_products_sql = (warehouseOid) => {
  const query = `
            SELECT
                  p.oid,
                  p.name AS product_name,
                  p.sku,
                  p.status,
                  p.restock_threshold,
                  p.unit_type,
                  c.name AS category_name,
                  s.name AS sub_category_name,
                  b.name AS brand_name,
                  w.name AS warehouse_name,
                  w.code AS warehouse_code,
                  w.location AS warehouse_location,
                  w.status AS warehouse_status,
                  COALESCE(COUNT(DISTINCT i.batch_code), 0) AS total_batches,
                  COALESCE(SUM(CAST(i.quantity_available AS INTEGER)), 0) AS total_available_quantity,
                  COALESCE(ps.total_sold, 0) AS total_quantity_sold,
                  COALESCE(ps.total_returned, 0) AS total_quantity_returned,
                  ROUND(COALESCE(MIN(CAST(i.selling_price AS NUMERIC)), 0), 2) AS min_price,
                  ROUND(COALESCE(MAX(CAST(i.selling_price AS NUMERIC)), 0), 2) AS max_price,
                  ROUND(COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0), 2) AS avg_price,
                  ROUND(COALESCE(SUM(CAST(i.quantity_available AS INTEGER) * CAST(COALESCE(i.selling_price, 0) AS NUMERIC)), 0), 2) AS total_inventory_value,
                  BOOL_OR(i.status = 'pending_pricing') AS has_pending_pricing,
                  BOOL_OR(i.intended_use = 'for_sale') AS has_for_sale_batch
            FROM ${TABLE.PRODUCT} p
            INNER JOIN ${TABLE.INVENTORY} i ON i.product_oid = p.oid
            INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.oid = i.purchase_details_oid
            INNER JOIN ${TABLE.WAREHOUSE} w ON w.oid = pd.warehouse_oid
            LEFT JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid
            INNER JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
            LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = s.category_oid
            LEFT JOIN ${TABLE.PRODUCT_STATS} ps ON ps.product_oid = p.oid
            WHERE pd.warehouse_oid = $1
            GROUP BY p.oid, p.name, p.sku, p.status, p.restock_threshold, p.unit_type, s.name, c.name, b.name, w.name, w.code, w.location, w.status, ps.total_sold, ps.total_returned
            ORDER BY p.name ASC
      `;
  return { text: query, values: [warehouseOid] };
};

const generate_products_xlsx = async (products, warehouseDetails) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Products");

  const titles = [
    "Product Name",
    "SKU",
    "Status",
    "Brand",
    "Category",
    "Sub Category",
    "Unit Type",
    "Total Batches",
    "Available Qty",
    "Qty Sold",
    "Qty Returned",
    "Restock Threshold",
    "Min Price",
    "Max Price",
    "Avg Price",
    "Inventory Value",
    "Has Pending Pricing",
    "Has For Sale Batch",
  ];

  // Add report header (logo + company info + title)
  addReportHeader(
    sheet,
    `Products List - ${warehouseDetails.name}`,
    titles.length,
  );

  // Add column titles (bold)
  const headerRowIndex = 5; // Titles go on row 5
  sheet.addRow(titles); // adds to next row (row 5)
  sheet.getRow(headerRowIndex).font = { bold: true };

  // Add data rows and calculate summary
  let totalProducts = 0;
  let totalAvailableQty = 0;
  let totalInventoryValue = 0;
  let totalQuantitySold = 0;
  let totalQuantityReturned = 0;
  let productsWithPendingPricing = 0;
  let productsWithForSale = 0;

  products.forEach((r) => {
    totalProducts++;
    totalAvailableQty += parseInt(r.total_available_quantity || 0);
    totalInventoryValue += parseFloat(r.total_inventory_value || 0);
    totalQuantitySold += parseInt(r.total_quantity_sold || 0);
    totalQuantityReturned += parseInt(r.total_quantity_returned || 0);
    if (r.has_pending_pricing) productsWithPendingPricing++;
    if (r.has_for_sale_batch) productsWithForSale++;

    sheet.addRow([
      r.product_name,
      r.sku || "N/A",
      r.status,
      r.brand_name || "N/A",
      r.category_name || "N/A",
      r.sub_category_name || "N/A",
      r.unit_type || "N/A",
      r.total_batches,
      r.total_available_quantity,
      r.total_quantity_sold || 0,
      r.total_quantity_returned || 0,
      r.restock_threshold,
      r.min_price,
      r.max_price,
      r.avg_price,
      r.total_inventory_value,
      r.has_pending_pricing ? "Yes" : "No",
      r.has_for_sale_batch ? "Yes" : "No",
    ]);
  });

  // Add warehouse details section
  sheet.addRow([]);
  sheet.addRow(["WAREHOUSE INFORMATION"]);
  sheet.addRow(["Warehouse Name:", warehouseDetails.name]);
  sheet.addRow(["Warehouse Code:", warehouseDetails.code || "N/A"]);
  sheet.addRow(["Location:", warehouseDetails.location || "N/A"]);
  sheet.addRow(["Status:", warehouseDetails.status]);
  sheet.getRow(sheet.rowCount - 4).font = { bold: true };
  sheet.getRow(sheet.rowCount - 3).font = { bold: true };
  sheet.getRow(sheet.rowCount - 2).font = { bold: true };
  sheet.getRow(sheet.rowCount - 1).font = { bold: true };
  sheet.getRow(sheet.rowCount).font = { bold: true };

  // Add summary rows
  const summaryRowIndex = sheet.rowCount + 2;
  sheet.addRow([]);
  sheet.addRow([
    "PRODUCTS SUMMARY",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
  sheet.addRow(["Total Products:", totalProducts]);
  sheet.addRow(["Total Available Quantity:", totalAvailableQty]);
  sheet.addRow(["Total Quantity Sold:", totalQuantitySold]);
  sheet.addRow(["Total Quantity Returned:", totalQuantityReturned]);
  sheet.addRow(["Total Inventory Value:", totalInventoryValue.toFixed(2)]);
  sheet.addRow(["Products with Pending Pricing:", productsWithPendingPricing]);
  sheet.addRow(["Products Ready for Sale:", productsWithForSale]);

  // Make summary rows bold
  sheet.getRow(summaryRowIndex + 1).font = { bold: true, size: 12 };
  sheet.getRow(summaryRowIndex + 2).font = { bold: true };
  sheet.getRow(summaryRowIndex + 3).font = { bold: true };
  sheet.getRow(summaryRowIndex + 4).font = { bold: true };
  sheet.getRow(summaryRowIndex + 5).font = { bold: true };
  sheet.getRow(summaryRowIndex + 6).font = { bold: true };
  sheet.getRow(summaryRowIndex + 7).font = { bold: true };
  sheet.getRow(summaryRowIndex + 8).font = { bold: true };

  // Auto-size columns
  sheet.columns.forEach((col) => {
    let max = 0;
    col.eachCell({ includeEmpty: false }, (cell) => {
      max = Math.max(max, (cell.value?.toString().length || 0) + 1);
    });
    col.width = Math.min(Math.max(max, 10), 30);
  });

  return workbook.xlsx.writeBuffer();
};

module.exports = generate_product_list_report_by_warehouse;
