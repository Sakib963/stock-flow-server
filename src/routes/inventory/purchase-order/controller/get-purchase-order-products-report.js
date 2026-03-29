const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const get_purchase_order_products_report = async (request, res) => {
  try {
    const data = await get_products_report_data(request.body?.oid);

    if (!data || data.length === 0) {
      return res.status(404).json({
        code: 404,
        message: "No Purchase Order products report Found",
        data: null,
      });
    }

    const buffer = await generate_products_report_xlsx(data);
    const timestamp = Date.now();
    const file_name = `purchase_order_products_${timestamp}.xlsx`;
    const file_name_ascii = file_name.replace(/[^\x00-\x7F]/g, "");
    const file_name_encoded = encodeURIComponent(file_name);

    log.info(`Download purchase order products report - [${file_name}]`);

    return res
      .set(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .set(
        "Content-Disposition",
        `attachment; filename="${file_name_ascii}"; filename*=UTF-8''${file_name_encoded}`,
      )
      .set("X-Filename", file_name_encoded)
      .set("Content-Length", buffer.length)
      .send(buffer);
  } catch (error) {
    log.error(
      `Error generating purchase order products report: ${error?.message}`,
    );
    return res
      .status(500)
      .json({ code: 500, message: "Internal server error" });
  }
};

const get_products_report_data = async (oid) => {
  const query = `
      SELECT
            po.oid as purchase_oid,
            po.status as purchase_status,
            po.created_on,
            s.name as supplier_name,
            p.name as product_name,
            w.name as warehouse_name,
            a.name as aisle_name,
            pd.ordered_quantity,
            pd.verified_quantity,
            pd.ordered_unit_price,
            pd.verified_unit_price,
            i.intended_use,
            i.selling_price,
            i.maximum_discount,
            pcp.ad_run_cost,
            pcp.packaging_cost,
            pcp.gift_cost,
            pcp.content_creation_cost,
            pcp.influencer_cost,
            pcp.cost_remarks,
            CASE
              WHEN i.intended_use = 'for_sale'
              THEN COALESCE(i.selling_price, 0) - COALESCE(pd.verified_unit_price, 0)
                - COALESCE(pcp.ad_run_cost, 0)
                - COALESCE(pcp.packaging_cost, 0)
                - COALESCE(pcp.gift_cost, 0)
                - COALESCE(pcp.content_creation_cost, 0)
                - COALESCE(pcp.influencer_cost, 0)
              ELSE NULL
            END as unit_profit_hint,
            i.status as inventory_status,
            i.batch_code
      FROM ${TABLE.PURCHASE} po
      LEFT JOIN ${TABLE.SUPPLIER} s ON po.supplier_oid = s.oid
      LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.purchase_oid = po.oid
      LEFT JOIN ${TABLE.PRODUCT} p ON p.oid = pd.product_oid
      LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = pd.warehouse_oid
      LEFT JOIN ${TABLE.AISLE} a ON a.oid = pd.aisle_oid
      LEFT JOIN ${TABLE.INVENTORY} i ON i.purchase_details_oid = pd.oid
          LEFT JOIN ${TABLE.PURCHASE_DETAILS_COST_PROFILE} pcp ON pcp.purchase_details_oid = pd.oid
      WHERE po.oid = $1
      ORDER BY p.name ASC
  `;

  return await get_data({ text: query, values: [oid] });
};

const generate_products_report_xlsx = async (data) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Purchase Products");

  addReportHeader(sheet, "Purchase Products Report", 10);

  let currentRow = 5;
  sheet.getCell(currentRow, 1).value = "Purchase Metadata";
  sheet.getCell(currentRow, 1).font = { bold: true, size: 14 };
  currentRow += 2;

  sheet.getCell(currentRow, 1).value = "Purchase OID:";
  sheet.getCell(currentRow, 1).font = { bold: true };
  sheet.getCell(currentRow, 2).value = data[0].purchase_oid;
  currentRow++;

  sheet.getCell(currentRow, 1).value = "Supplier:";
  sheet.getCell(currentRow, 1).font = { bold: true };
  sheet.getCell(currentRow, 2).value = data[0].supplier_name;
  currentRow += 2;

  const columns = [
    "Product",
    "Warehouse",
    "Aisle",
    "Ordered Qty",
    "Verified Qty",
    "Ordered Unit Price",
    "Verified Unit Price",
    "Intended Use",
    "Selling Price",
    "Max Discount",
    "Ad Run Cost",
    "Packaging Cost",
    "Gift Cost",
    "Content Cost",
    "Influencer Cost",
    "Total Extra Cost / Unit",
    "Unit Profit Hint",
    "Cost Remarks",
    "Inventory Status",
    "Batch Code",
  ];

  const headerRow = sheet.getRow(currentRow);
  columns.forEach((col, idx) => {
    headerRow.getCell(idx + 1).value = col;
  });
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD3D3D3" },
  };
  currentRow++;

  data.forEach((item) => {
    sheet.addRow([
      item.product_name,
      item.warehouse_name,
      item.aisle_name,
      item.ordered_quantity,
      item.verified_quantity,
      item.ordered_unit_price,
      item.verified_unit_price,
      item.intended_use,
      item.selling_price,
      item.maximum_discount,
      item.ad_run_cost,
      item.packaging_cost,
      item.gift_cost,
      item.content_creation_cost,
      item.influencer_cost,
      Number(item.ad_run_cost || 0) +
        Number(item.packaging_cost || 0) +
        Number(item.gift_cost || 0) +
        Number(item.content_creation_cost || 0) +
        Number(item.influencer_cost || 0),
      item.unit_profit_hint,
      item.cost_remarks,
      item.inventory_status,
      item.batch_code,
    ]);
  });

  sheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const length = cell.value?.toString().length || 0;
      max = Math.max(max, length + 2);
    });
    col.width = Math.min(max, 30);
  });

  return workbook.xlsx.writeBuffer();
};

module.exports = get_purchase_order_products_report;
