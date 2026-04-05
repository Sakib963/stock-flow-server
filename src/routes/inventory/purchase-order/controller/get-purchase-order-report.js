const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const get_purchase_order_report = async (request, res) => {
  try {
    const data = await get_report_data(request.body?.oid);

    if (!data || data.length === 0) {
      return res.status(404).json({
        code: 404,
        message: "No Purchase Order report Found",
        data: null,
      });
    }

    const buffer = await generate_purchase_report_xlsx(data);
    const timestamp = Date.now();
    const file_name = `purchase_order_report_${timestamp}.xlsx`;
    const file_name_ascii = file_name.replace(/[^\x00-\x7F]/g, "");
    const file_name_encoded = encodeURIComponent(file_name);

    log.info(`Download purchase order report - [${file_name}]`);

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
    log.error(`Error generating purchase order report: ${error?.message}`);
    return res
      .status(500)
      .json({ code: 500, message: "Internal server error" });
  }
};

const get_report_data = async (oid) => {
  const query = `
      SELECT po.oid, po.supplier_oid, po.total_amount, po.special_notes, po.payment_status, po.paid_amount, po.purchase_type, po.status, po.created_by, po.created_on, po.edited_by, po.edited_on, po.cancelled_by, po.cancelled_on, po.verified_by, po.verified_on, s.name AS supplier_name,
      JSON_AGG(JSON_BUILD_OBJECT(
            'purchase_details_oid', pd.oid,
            'product_oid', p.oid,
            'product_name', p.name,
            'category_name', (SELECT c.name FROM ${TABLE.CATEGORIES} AS c WHERE c.oid = p.category_oid),
            'sub_category_name', (SELECT sc.name FROM ${TABLE.SUB_CATEGORIES} AS sc WHERE sc.oid = p.sub_category_oid),
            'warehouse_name', (SELECT w.name FROM ${TABLE.WAREHOUSE} AS w WHERE w.oid = pd.warehouse_oid),
            'aisle_name', (SELECT a.name FROM ${TABLE.AISLE} AS a WHERE a.oid = pd.aisle_oid),
            'batch_code', i.batch_code,
            'ordered_quantity', pd.ordered_quantity,
            'verified_quantity', pd.verified_quantity,
            'ordered_unit_price', pd.ordered_unit_price,
            'verified_unit_price', pd.verified_unit_price,
            'selling_price', i.selling_price,
            'maximum_discount', i.maximum_discount,
            'ad_run_cost', pcp.ad_run_cost,
            'packaging_cost', pcp.packaging_cost,
            'gift_cost', pcp.gift_cost,
            'content_creation_cost', pcp.content_creation_cost,
            'influencer_cost', pcp.influencer_cost,
            'cost_remarks', pcp.cost_remarks,
            'unit_profit_hint',
              CASE
                WHEN i.intended_use = 'for_sale'
                THEN COALESCE(i.selling_price, 0) - COALESCE(pd.verified_unit_price, 0)
                  - COALESCE(pcp.ad_run_cost, 0)
                  - COALESCE(pcp.packaging_cost, 0)
                  - COALESCE(pcp.gift_cost, 0)
                  - COALESCE(pcp.content_creation_cost, 0)
                  - COALESCE(pcp.influencer_cost, 0)
                ELSE NULL
              END
      )) AS purchase_details
      FROM ${TABLE.PURCHASE} AS po
      LEFT JOIN ${TABLE.SUPPLIER} AS s ON po.supplier_oid = s.oid
      LEFT JOIN ${TABLE.PURCHASE_DETAILS} AS pd ON po.oid = pd.purchase_oid
      LEFT JOIN ${TABLE.PRODUCT} AS p ON pd.product_oid = p.oid
      LEFT JOIN ${TABLE.INVENTORY} AS i ON pd.oid = i.purchase_details_oid
          LEFT JOIN ${TABLE.PURCHASE_DETAILS_COST_PROFILE} AS pcp ON pcp.purchase_details_oid = pd.oid
      WHERE po.oid = $1
      GROUP BY po.oid, s.name
  `;

  return await get_data({ text: query, values: [oid] });
};

const generate_purchase_report_xlsx = async (data) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Purchase Order Report");

  const purchaseOrder = data[0];
  const purchaseDetails = purchaseOrder.purchase_details || [];

  addReportHeader(sheet, "Purchase Order Report", 10);

  let currentRow = 5;
  sheet.getCell(currentRow, 1).value = "Purchase Order Details";
  sheet.getCell(currentRow, 1).font = { bold: true, size: 14 };
  currentRow += 2;

  const basicInfo = [
    ["Supplier:", purchaseOrder.supplier_name],
    ["Total Amount:", purchaseOrder.total_amount],
    ["Paid Amount:", purchaseOrder.paid_amount],
    ["Payment Status:", purchaseOrder.payment_status],
    ["Purchase Type:", purchaseOrder.purchase_type],
    ["Status:", purchaseOrder.status],
    [
      "Created On:",
      purchaseOrder.created_on
        ? new Date(purchaseOrder.created_on).toLocaleString()
        : "",
    ],
    [
      "Verified On:",
      purchaseOrder.verified_on
        ? new Date(purchaseOrder.verified_on).toLocaleString()
        : "",
    ],
    ["Special Notes:", purchaseOrder.special_notes || ""],
  ];

  basicInfo.forEach(([label, value]) => {
    sheet.getCell(currentRow, 1).value = label;
    sheet.getCell(currentRow, 1).font = { bold: true };
    sheet.getCell(currentRow, 2).value = value;
    sheet.mergeCells(currentRow, 2, currentRow, 6);
    currentRow++;
  });

  currentRow += 2;
  sheet.getCell(currentRow, 1).value = "Product Details";
  sheet.getCell(currentRow, 1).font = { bold: true, size: 14 };
  currentRow += 2;

  const productColumns = [
    "Product Name",
    "Category",
    "Sub Category",
    "Warehouse",
    "Aisle",
    "Batch Code",
    "Ordered Qty",
    "Verified Qty",
    "Ordered Price",
    "Verified Price",
  ];

  const headerRow = sheet.getRow(currentRow);
  productColumns.forEach((col, idx) => {
    headerRow.getCell(idx + 1).value = col;
  });
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD3D3D3" },
  };
  currentRow++;

  purchaseDetails.forEach((detail) => {
    sheet.addRow([
      detail.product_name,
      detail.category_name,
      detail.sub_category_name,
      detail.warehouse_name,
      detail.aisle_name,
      detail.batch_code,
      detail.ordered_quantity,
      detail.verified_quantity,
      detail.ordered_unit_price,
      detail.verified_unit_price,
    ]);
    currentRow++;
  });

  sheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const length = cell.value?.toString().length || 0;
      max = Math.max(max, length + 2);
    });
    col.width = Math.min(max, 30);
  });

  const costSheet = workbook.addWorksheet("Cost Breakdown");
  addReportHeader(costSheet, "Purchase Cost Breakdown", 14);

  let costRow = 5;
  costSheet.getCell(costRow, 1).value = "Cost Summary";
  costSheet.getCell(costRow, 1).font = { bold: true, size: 14 };
  costRow += 2;

  const summaryInfo = [
    ["Supplier:", purchaseOrder.supplier_name],
    ["Purchase OID:", purchaseOrder.oid],
  ];

  summaryInfo.forEach(([label, value]) => {
    costSheet.getCell(costRow, 1).value = label;
    costSheet.getCell(costRow, 1).font = { bold: true };
    costSheet.getCell(costRow, 2).value = value;
    costSheet.mergeCells(costRow, 2, costRow, 6);
    costRow++;
  });

  costRow += 2;
  const hasAnyCostBreakdown = purchaseDetails.some(
    (detail) =>
      Number(detail.ad_run_cost || 0) > 0 ||
      Number(detail.packaging_cost || 0) > 0 ||
      Number(detail.gift_cost || 0) > 0 ||
      Number(detail.content_creation_cost || 0) > 0 ||
      Number(detail.influencer_cost || 0) > 0 ||
      !!(detail.cost_remarks && `${detail.cost_remarks}`.trim()),
  );

  if (!hasAnyCostBreakdown) {
    costSheet.getCell(costRow, 1).value =
      "No cost breakdown data available for this purchase order.";
    costSheet.getCell(costRow, 1).font = {
      italic: true,
      color: { argb: "FF666666" },
    };
    costSheet.mergeCells(costRow, 1, costRow, 8);
  }

  if (hasAnyCostBreakdown) {
    const costColumns = [
      "Product",
      "Batch Code",
      "Verified Qty",
      "Verified Unit Price",
      "Selling Price",
      "Max Discount",
      "Ad Run Cost",
      "Packaging Cost",
      "Gift Cost",
      "Content Cost",
      "Influencer Cost",
      "Total Extra Cost / Unit",
      "Probable Profit / Unit",
      "Probable Profit (Batch)",
      "Cost Remarks",
    ];

    const costHeaderRow = costSheet.getRow(costRow);
    costColumns.forEach((col, idx) => {
      costHeaderRow.getCell(idx + 1).value = col;
    });
    costHeaderRow.font = { bold: true };
    costHeaderRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD3D3D3" },
    };
    costRow++;

    purchaseDetails.forEach((detail) => {
      const totalExtraCostPerUnit =
        Number(detail.ad_run_cost || 0) +
        Number(detail.packaging_cost || 0) +
        Number(detail.gift_cost || 0) +
        Number(detail.content_creation_cost || 0) +
        Number(detail.influencer_cost || 0);
      const probableProfitPerUnit = Number(detail.unit_profit_hint || 0);
      const probableProfitLine =
        probableProfitPerUnit * Number(detail.verified_quantity || 0);

      costSheet.addRow([
        detail.product_name,
        detail.batch_code,
        detail.verified_quantity,
        detail.verified_unit_price,
        detail.selling_price,
        detail.maximum_discount,
        detail.ad_run_cost,
        detail.packaging_cost,
        detail.gift_cost,
        detail.content_creation_cost,
        detail.influencer_cost,
        totalExtraCostPerUnit,
        probableProfitPerUnit,
        probableProfitLine,
        detail.cost_remarks,
      ]);
    });
  }

  costSheet.columns.forEach((col) => {
    let max = 10;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const length = cell.value?.toString().length || 0;
      max = Math.max(max, length + 2);
    });
    col.width = Math.min(max, 32);
  });

  return workbook.xlsx.writeBuffer();
};

module.exports = get_purchase_order_report;
