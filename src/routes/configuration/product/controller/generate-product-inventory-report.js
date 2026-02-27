const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const generate_product_inventory_report = async (request, res) => {
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

    // Get inventory data
    const inventorySql = generate_inventory_sql(productOid);
    const inventory = await get_data(inventorySql);

    const buffer = await generate_inventory_xlsx(inventory, productDetails);
    const timestamp = Date.now();
    const file_name = `${productDetails.name.replace(/\s+/g, "_")}_inventory_report_${timestamp}.xlsx`;
    const file_name_ascii = file_name.replace(/[^\x00-\x7F]/g, "");
    const file_name_encoded = encodeURIComponent(file_name);

    log.info(
      `Download inventory report for product [${productDetails.name}] - [${file_name}]`,
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
      `An exception occurred while generating product inventory report: ${e?.message}`,
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

const generate_inventory_sql = (productOid) => {
  const query = `
            SELECT
                  i.batch_code,
                  CAST(i.initial_quantity AS INTEGER) AS initial_quantity,
                  CAST(i.quantity_available AS INTEGER) AS quantity_available,
                  CAST(i.initial_quantity - i.quantity_available AS INTEGER) AS quantity_used,
                  ROUND(CAST(i.cost_price AS NUMERIC), 2) AS cost_price,
                  ROUND(CAST(COALESCE(i.selling_price, 0) AS NUMERIC), 2) AS selling_price,
                  ROUND((CAST(i.quantity_available AS NUMERIC) * CAST(COALESCE(i.selling_price, 0) AS NUMERIC)), 2) AS inventory_value,
                  ROUND((CAST(i.quantity_available AS NUMERIC) * CAST(i.cost_price AS NUMERIC)), 2) AS cost_value,
                  i.maximum_discount,
                  i.status AS batch_status,
                  i.intended_use,
                  TO_CHAR(i.created_on, 'YYYY-MM-DD') AS batch_created_date,
                  TO_CHAR(pu.created_on, 'YYYY-MM-DD') AS purchase_date,
                  sup.name AS supplier_name,
                  w.name AS warehouse_name,
                  a.name AS aisle_name
            FROM ${TABLE.INVENTORY} i
            LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.oid = i.purchase_details_oid
            LEFT JOIN ${TABLE.PURCHASE} pu ON pu.oid = pd.purchase_oid
            LEFT JOIN ${TABLE.SUPPLIER} sup ON sup.oid = pu.supplier_oid
            LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = pd.warehouse_oid
            LEFT JOIN ${TABLE.AISLE} a ON a.oid = pd.aisle_oid
            WHERE i.product_oid = $1
            ORDER BY i.created_on DESC
      `;
  return { text: query, values: [productOid] };
};

const generate_inventory_xlsx = async (inventory, productDetails) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Inventory");

  const titles = [
    "Batch Code",
    "Initial Qty",
    "Available Qty",
    "Used Qty",
    "Cost Price",
    "Selling Price",
    "Inventory Value",
    "Cost Value",
    "Max Discount",
    "Status",
    "Intended Use",
    "Supplier",
    "Warehouse",
    "Aisle",
    "Purchase Date",
    "Batch Created",
  ];

  // Add report header
  addReportHeader(
    sheet,
    `Product Inventory Report - ${productDetails.name}`,
    titles.length,
  );

  // Add column titles
  const headerRowIndex = 5;
  sheet.addRow(titles);
  sheet.getRow(headerRowIndex).font = { bold: true };

  // Add data rows
  let totalInventoryValue = 0;
  let totalCostValue = 0;
  let totalAvailable = 0;
  let totalUsed = 0;

  inventory.forEach((r) => {
    totalInventoryValue += parseFloat(r.inventory_value || 0);
    totalCostValue += parseFloat(r.cost_value || 0);
    totalAvailable += parseInt(r.quantity_available || 0);
    totalUsed += parseInt(r.quantity_used || 0);

    sheet.addRow([
      r.batch_code,
      r.initial_quantity,
      r.quantity_available,
      r.quantity_used,
      r.cost_price,
      r.selling_price,
      r.inventory_value,
      r.cost_value,
      r.maximum_discount || 0,
      r.batch_status,
      r.intended_use || "N/A",
      r.supplier_name || "N/A",
      r.warehouse_name || "N/A",
      r.aisle_name || "N/A",
      r.purchase_date || "N/A",
      r.batch_created_date || "N/A",
    ]);
  });

  // Add product details section
  sheet.addRow([]);
  sheet.addRow(["PRODUCT INFORMATION"]);
  sheet.addRow(["Product Name:", productDetails.name]);
  sheet.addRow(["SKU:", productDetails.sku || "N/A"]);
  sheet.addRow(["Category:", productDetails.category_name || "N/A"]);
  sheet.addRow(["Sub Category:", productDetails.sub_category_name || "N/A"]);
  sheet.addRow(["Brand:", productDetails.brand_name || "N/A"]);
  sheet.addRow(["Product Nature:", productDetails.product_nature || "N/A"]);
  sheet.addRow(["Unit Type:", productDetails.unit_type || "N/A"]);

  const infoStartRow = sheet.rowCount - 8;
  sheet.getRow(infoStartRow).font = { bold: true, size: 12 };
  for (let i = 1; i <= 8; i++) {
    sheet.getRow(infoStartRow + i).font = { bold: true };
  }

  // Add summary section
  sheet.addRow([]);
  const summaryRowIndex = sheet.rowCount;
  sheet.addRow(["SUMMARY"]);
  sheet.addRow(["Total Batches:", "", inventory.length]);
  sheet.addRow(["Total Available Quantity:", "", totalAvailable]);
  sheet.addRow(["Total Used Quantity:", "", totalUsed]);
  sheet.addRow(["Total Cost Value:", "", totalCostValue.toFixed(2)]);
  sheet.addRow([
    "Total Inventory Value (Selling Price):",
    "",
    totalInventoryValue.toFixed(2),
  ]);
  sheet.addRow([
    "Potential Profit:",
    "",
    (totalInventoryValue - totalCostValue).toFixed(2),
  ]);

  sheet.getRow(summaryRowIndex + 1).font = { bold: true, size: 12 };
  for (let i = 2; i <= 7; i++) {
    sheet.getRow(summaryRowIndex + i).font = { bold: true };
  }

  // Auto-size columns
  sheet.columns.forEach((col) => {
    let max = 0;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const length = cell.value?.toString().length || 0;
      max = Math.max(max, length);
    });
    col.width = Math.min(Math.max(max + 1, 10), 30);
  });

  return workbook.xlsx.writeBuffer();
};

module.exports = generate_product_inventory_report;
