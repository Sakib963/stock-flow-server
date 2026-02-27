const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const generate_inventory_report_by_aisle = async (request, res) => {
  try {
    const payload = request.body;
    const aisleOid = payload.oid;

    if (!aisleOid) {
      log.warn("Aisle OID is required");
      return res.status(400).json({
        code: 400,
        message: "Aisle OID is required",
        data: null,
      });
    }

    // Get inventory with aisle details in a single query
    const inventorySql = generate_inventory_sql(aisleOid);
    const inventory = await get_data(inventorySql);

    if (!inventory || inventory.length === 0) {
      log.info(`No inventory found for aisle OID: ${aisleOid}`);
      return res.status(404).json({
        code: 404,
        message: "No inventory data found for this aisle",
        data: null,
      });
    }

    // Extract aisle details from first row (same for all inventory items)
    const aisleDetails = {
      name: inventory[0].aisle_name_detail,
      code: inventory[0].aisle_code,
      warehouse_name: inventory[0].warehouse_name,
      capacity: inventory[0].aisle_capacity,
      type_of_storage: inventory[0].type_of_storage,
      status: inventory[0].aisle_status,
    };

    const buffer = await generate_inventory_xlsx(inventory, aisleDetails);
    const timestamp = Date.now();
    const file_name = `${aisleDetails.name.replace(/\s+/g, "_")}_inventory_report_${timestamp}.xlsx`;
    // Create ASCII-safe fallback filename by removing non-ASCII characters
    const file_name_ascii = file_name.replace(/[^\x00-\x7F]/g, "");
    // Encode filename for RFC 5987 (UTF-8 support in headers)
    const file_name_encoded = encodeURIComponent(file_name);
    log.info(
      `Download inventory report for aisle [${aisleDetails.name}] - [${file_name}]`,
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
      `An exception occurred while generating inventory report by aisle: ${e?.message}`,
    );
    console.error(e);
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
    });
  }
};

const generate_inventory_sql = (aisleOid) => {
  const query = `
            SELECT
                  p.name AS product_name,
                  p.sku,
                  b.name AS brand_name,
                  c.name AS category_name,
                  s.name AS sub_category_name,
                  w.name AS warehouse_name,
                  a.name AS aisle_name_detail,
                  a.code AS aisle_code,
                  a.capacity AS aisle_capacity,
                  a.type_of_storage,
                  a.status AS aisle_status,
                  i.batch_code,
                  CAST(i.initial_quantity AS INTEGER) AS initial_quantity,
                  CAST(i.quantity_available AS INTEGER) AS quantity_available,
                  ROUND(CAST(i.cost_price AS NUMERIC), 2) AS cost_price,
                  ROUND(CAST(COALESCE(i.selling_price, 0) AS NUMERIC), 2) AS selling_price,
                  ROUND((CAST(i.quantity_available AS NUMERIC) * CAST(COALESCE(i.selling_price, 0) AS NUMERIC)), 2) AS inventory_value,
                  ROUND((CAST(i.quantity_available AS NUMERIC) * CAST(i.cost_price AS NUMERIC)), 2) AS cost_value,
                  i.maximum_discount,
                  i.status AS batch_status,
                  i.intended_use,
                  TO_CHAR(pu.created_on, 'YYYY-MM-DD') AS purchase_date,
                  TO_CHAR(i.created_on, 'YYYY-MM-DD') AS batch_created_date,
                  sup.name AS supplier_name
            FROM ${TABLE.INVENTORY} i
            INNER JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
            LEFT JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid
            INNER JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
            LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = s.category_oid
            INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.oid = i.purchase_details_oid
            INNER JOIN ${TABLE.AISLE} a ON a.oid = pd.aisle_oid
            LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = a.warehouse_oid
            LEFT JOIN ${TABLE.PURCHASE} pu ON pu.oid = pd.purchase_oid
            LEFT JOIN ${TABLE.SUPPLIER} sup ON sup.oid = pu.supplier_oid
            WHERE pd.aisle_oid = $1
            ORDER BY p.name ASC, i.batch_code ASC
      `;
  return { text: query, values: [aisleOid] };
};

const generate_inventory_xlsx = async (inventory, aisleDetails) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Inventory");

  const titles = [
    "Product Name",
    "SKU",
    "Brand",
    "Category",
    "Sub Category",
    "Warehouse",
    "Batch Code",
    "Initial Qty",
    "Available Qty",
    "Cost Price",
    "Selling Price",
    "Inventory Value",
    "Cost Value",
    "Max Discount",
    "Batch Status",
    "Intended Use",
    "Supplier",
    "Purchase Date",
    "Batch Created",
  ];

  // Add report header (logo + company info + title)
  addReportHeader(
    sheet,
    `Inventory Report - ${aisleDetails.name}`,
    titles.length,
  );

  // Add column titles (bold)
  const headerRowIndex = 5; // Titles go on row 5
  sheet.addRow(titles); // adds to next row (row 5)
  sheet.getRow(headerRowIndex).font = { bold: true };

  // Add data rows
  let totalInventoryValue = 0;
  let totalCostValue = 0;
  inventory.forEach((r) => {
    totalInventoryValue += parseFloat(r.inventory_value || 0);
    totalCostValue += parseFloat(r.cost_value || 0);
    sheet.addRow([
      r.product_name,
      r.sku || "N/A",
      r.brand_name || "N/A",
      r.category_name || "N/A",
      r.sub_category_name || "N/A",
      r.warehouse_name || "N/A",
      r.batch_code,
      r.initial_quantity,
      r.quantity_available,
      r.cost_price,
      r.selling_price,
      r.inventory_value,
      r.cost_value,
      r.maximum_discount || 0,
      r.batch_status,
      r.intended_use || "N/A",
      r.supplier_name || "N/A",
      r.purchase_date || "N/A",
      r.batch_created_date || "N/A",
    ]);
  });

  // Add aisle details section
  sheet.addRow([]);
  sheet.addRow(["AISLE INFORMATION"]);
  sheet.addRow(["Aisle Name:", aisleDetails.name]);
  sheet.addRow(["Aisle Code:", aisleDetails.code || "N/A"]);
  sheet.addRow(["Warehouse:", aisleDetails.warehouse_name || "N/A"]);
  sheet.addRow(["Capacity:", aisleDetails.capacity || "N/A"]);
  sheet.addRow(["Type of Storage:", aisleDetails.type_of_storage || "N/A"]);
  sheet.addRow(["Status:", aisleDetails.status]);
  sheet.getRow(sheet.rowCount - 6).font = { bold: true };
  sheet.getRow(sheet.rowCount - 5).font = { bold: true };
  sheet.getRow(sheet.rowCount - 4).font = { bold: true };
  sheet.getRow(sheet.rowCount - 3).font = { bold: true };
  sheet.getRow(sheet.rowCount - 2).font = { bold: true };
  sheet.getRow(sheet.rowCount - 1).font = { bold: true };
  sheet.getRow(sheet.rowCount).font = { bold: true };

  // Add summary rows
  const summaryRowIndex = sheet.rowCount + 2;
  sheet.addRow([]);
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
  sheet.getRow(summaryRowIndex + 1).font = { bold: true };
  sheet.getRow(summaryRowIndex + 2).font = { bold: true };
  sheet.getRow(summaryRowIndex + 3).font = { bold: true };

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

module.exports = generate_inventory_report_by_aisle;
