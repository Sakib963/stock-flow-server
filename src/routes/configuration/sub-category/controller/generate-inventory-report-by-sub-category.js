const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { BATCH_FIGURES } = require("../../../inventory/overview/utils/stock-figures");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");
const { business_day } = require("../../../../utils/business-time");

const generate_inventory_report_by_sub_category = async (request, res) => {
  try {
    const payload = request.body;
    const subCategoryOid = payload.oid;

    if (!subCategoryOid) {
      log.warn("Sub-Category OID is required");
      return res.status(400).json({
        code: 400,
        message: "Sub-Category OID is required",
        data: null,
      });
    }

    // Get inventory with sub-category details in a single query
    const inventorySql = generate_inventory_sql(subCategoryOid);
    const inventory = await get_data(inventorySql);

    if (!inventory || inventory.length === 0) {
      log.info(`No inventory found for sub-category OID: ${subCategoryOid}`);
      return res.status(404).json({
        code: 404,
        message: "No inventory data found for this sub-category",
        data: null,
      });
    }

    // Extract sub-category details from first row (same for all inventory items)
    const subCategoryDetails = {
      name: inventory[0].sub_category_name_detail,
      description: inventory[0].sub_category_description,
      status: inventory[0].sub_category_status,
      category_code: inventory[0].category_code,
      parent_category_name: inventory[0].parent_category_name,
    };

    const buffer = await generate_inventory_xlsx(inventory, subCategoryDetails);
    const timestamp = Date.now();
    const file_name = `${subCategoryDetails.name.replace(/\s+/g, "_")}_inventory_report_${timestamp}.xlsx`;
    const file_name_ascii = file_name.replace(/[^\x00-\x7F]/g, "");
    const file_name_encoded = encodeURIComponent(file_name);
    log.info(
      `Download inventory report for sub-category [${subCategoryDetails.name}] - [${file_name}]`,
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
      `An exception occurred while generating inventory report: ${e?.message}`,
    );
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
    });
  }
};

const generate_inventory_sql = (subCategoryOid) => {
  const query = `
            SELECT
                  p.name AS product_name,
                  p.sku,
                  s.name AS sub_category_name,
                  s.name AS sub_category_name_detail,
                  s.description AS sub_category_description,
                  s.status AS sub_category_status,
                  s.category_code,
                  c.name AS parent_category_name,
                  i.batch_code,
                  i.initial_quantity,
                  i.on_hand,
                  i.held,
                  i.sellable,
                  i.cost_price,
                  i.selling_price,
                  (i.on_hand * i.cost_price) AS cost_value,
                  i.maximum_discount,
                  i.status AS batch_status,
                  i.intended_use,
                  TO_CHAR(${business_day("pu.created_on")}, 'YYYY-MM-DD') AS purchase_date,
                  TO_CHAR(${business_day("i.received_on")}, 'YYYY-MM-DD') AS batch_created_date,
                  sup.name AS supplier_name,
                  w.name AS warehouse_name,
                  a.name AS aisle_name
            FROM (${BATCH_FIGURES}) i
            INNER JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
            INNER JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
            LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = s.category_oid
            LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.oid = i.purchase_details_oid
            LEFT JOIN ${TABLE.PURCHASE} pu ON pu.oid = pd.purchase_oid
            LEFT JOIN ${TABLE.SUPPLIER} sup ON sup.oid = pu.supplier_oid
            LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = i.warehouse_oid
            LEFT JOIN ${TABLE.AISLE} a ON a.oid = i.aisle_oid
            WHERE p.sub_category_oid = $1 AND p.is_deleted = FALSE
            ORDER BY p.name ASC, i.batch_code ASC
      `;
  return { text: query, values: [subCategoryOid] };
};

const generate_inventory_xlsx = async (inventory, subCategoryDetails) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Inventory");

  const titles = [
    "Product Name",
    "SKU",
    "Sub Category",
    "Batch Code",
    "Initial Qty",
    "On Hand",
    "Held",
    "Sellable",
    "Cost Price",
    "Selling Price",
    "Stock Value (Cost)",
    "Max Discount",
    "Batch Status",
    "Intended Use",
    "Supplier",
    "Warehouse",
    "Aisle",
    "Purchase Date",
    "Batch Created",
  ];

  // Add report header (logo + company info + title)
  addReportHeader(
    sheet,
    `Inventory Report - ${subCategoryDetails.name}`,
    titles.length,
  );

  // Add column titles (bold)
  const headerRowIndex = 5; // Titles go on row 5
  sheet.addRow(titles); // adds to next row (row 5)
  sheet.getRow(headerRowIndex).font = { bold: true };

  // Add data rows
  let totalCostValue = 0;
  inventory.forEach((r) => {
    totalCostValue += parseFloat(r.cost_value || 0);
    sheet.addRow([
      r.product_name,
      r.sku || "N/A",
      r.sub_category_name || "N/A",
      r.batch_code,
      r.initial_quantity,
      r.on_hand,
      r.held,
      r.sellable,
      r.cost_price,
      r.selling_price ?? "Not priced",
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

  // Add sub-category details section
  sheet.addRow([]);
  sheet.addRow(["SUB-CATEGORY INFORMATION"]);
  sheet.addRow(["Sub-Category Name:", subCategoryDetails.name]);
  sheet.addRow([
    "Parent Category:",
    subCategoryDetails.parent_category_name || "N/A",
  ]);
  sheet.addRow(["Category Code:", subCategoryDetails.category_code]);
  sheet.addRow(["Description:", subCategoryDetails.description || "N/A"]);
  sheet.addRow(["Status:", subCategoryDetails.status]);
  sheet.getRow(sheet.rowCount - 5).font = { bold: true, size: 12 };
  sheet.getRow(sheet.rowCount - 4).font = { bold: true };
  sheet.getRow(sheet.rowCount - 3).font = { bold: true };
  sheet.getRow(sheet.rowCount - 2).font = { bold: true };
  sheet.getRow(sheet.rowCount - 1).font = { bold: true };
  sheet.getRow(sheet.rowCount).font = { bold: true };

  // Add summary rows
  const summaryRowIndex = sheet.rowCount + 2;
  sheet.addRow([]);
  sheet.addRow(["Stock Value at Cost:", "", totalCostValue.toFixed(2)]);
  sheet.getRow(summaryRowIndex + 1).font = { bold: true };

  // Auto-size columns
  sheet.columns.forEach((col) => {
    let max = 0;
    col.eachCell({ includeEmpty: true }, (cell) => {
      max = Math.max(max, (cell.value?.toString().length || 0) + 2);
    });
    col.width = max;
  });

  return workbook.xlsx.writeBuffer();
};

module.exports = generate_inventory_report_by_sub_category;
