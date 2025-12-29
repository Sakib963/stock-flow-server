const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const get_purchase_order_report = async (request, res) => {
      try {
            let data = await get_report_data(request);
            if (!data || data.length === 0) {
                  log.info("No Purchase Order report Found");
                  return res.status(404).json({
                        code: 404,
                        message: "No Purchase Order report Found",
                        data: null,
                  });
            }
            const buffer = await generate_product_wise_stock_xlsx(data);
            const timestamp = Date.now();
            const file_name = `purchase_order_report_${timestamp}.xlsx`;

            log.info(`Download purchase order report - [${file_name}]`);

            res
                  .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                  .set("Content-Disposition", `attachment; filename="${file_name}"`)
                  .set("X-Filename", file_name)  // <-- new header
                  .set("Content-Length", buffer.length)
                  .send(buffer);


      } catch (error) {
            console.error("Error fetching product_wise_stock report:", error);
            res.status(500).json({ error: "Internal server error" });
      }
}

const get_report_data = async (request) => {
      const payload = request.body;
      const values = [];
      let query = `
            SELECT po.oid,  po.supplier_oid,  po.total_amount,  po.special_notes,  po.payment_status,  po.paid_amount,  po.purchase_type,  po.status,  po.created_by,  po.created_on,  po.edited_by,  po.edited_on,  po.cancelled_by,  po.cancelled_on,  po.verified_by,  po.verified_on, s.name AS supplier_name, 
            JSON_AGG(JSON_BUILD_OBJECT(
                  'purchase_details_oid', pd.oid,
                  'product_oid', p.oid,
                  'product_name', p.name,
                  'category_name', (SELECT c.name FROM ${TABLE.CATEGORIES} AS c WHERE c.oid = p.category_oid),
                  'sub_category_name', (SELECT sc.name FROM ${TABLE.SUB_CATEGORIES} AS sc WHERE sc.oid = p.sub_category_oid),
                  'warehouse_oid', (SELECT w.name FROM ${TABLE.WAREHOUSE} AS w WHERE w.oid = pd.warehouse_oid),
                  'aisle_oid', (SELECT a.name FROM ${TABLE.AISLE} AS a WHERE a.oid = pd.aisle_oid),
                  'batch_code', i.batch_code,
                  'ordered_quantity', pd.ordered_quantity,
                  'verified_quantity', pd.verified_quantity,
                  'ordered_unit_price', pd.ordered_unit_price,
                  'verified_unit_price', pd.verified_unit_price
            )) AS purchase_details
            FROM ${TABLE.PURCHASE} AS po
            LEFT JOIN ${TABLE.SUPPLIER} AS s ON po.supplier_oid = s.oid
            LEFT JOIN ${TABLE.PURCHASE_DETAILS} AS pd ON po.oid = pd.purchase_oid
            LEFT JOIN ${TABLE.PRODUCT} AS p ON pd.product_oid = p.oid
            LEFT JOIN ${TABLE.INVENTORY} AS i ON pd.oid = i.purchase_details_oid
            WHERE 1=1 AND po.oid = $1 group BY po.oid, s.name 
            `;
      values.push(payload.oid);
      const sql = { text: query, values };
      return await get_data(sql);
};


const generate_product_wise_stock_xlsx = async (data) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Purchase Order Report");

      // Get purchase order data
      const purchaseOrder = data[0];
      const purchaseDetails = purchaseOrder.purchase_details || [];

      // Add header (logo + company + report title)
      addReportHeader(sheet, "Purchase Order Report", 10);

      let currentRow = 5;

      // Add Purchase Order Basic Details
      sheet.getCell(currentRow, 1).value = "Purchase Order Details";
      sheet.getCell(currentRow, 1).font = { bold: true, size: 14 };
      currentRow += 2;

      // Basic info section
      const basicInfo = [
            ["Supplier:", purchaseOrder.supplier_name],
            ["Total Amount:", purchaseOrder.total_amount],
            ["Paid Amount:", purchaseOrder.paid_amount],
            ["Payment Status:", purchaseOrder.payment_status],
            ["Purchase Type:", purchaseOrder.purchase_type],
            ["Status:", purchaseOrder.status],
            ["Created On:", purchaseOrder.created_on ? new Date(purchaseOrder.created_on).toLocaleString() : ""],
            ["Verified On:", purchaseOrder.verified_on ? new Date(purchaseOrder.verified_on).toLocaleString() : ""],
            ["Special Notes:", purchaseOrder.special_notes || ""]
      ];

      basicInfo.forEach(([label, value]) => {
            sheet.getCell(currentRow, 1).value = label;
            sheet.getCell(currentRow, 1).font = { bold: true };
            sheet.getCell(currentRow, 2).value = value;
            sheet.mergeCells(currentRow, 2, currentRow, 5);
            currentRow++;
      });

      currentRow += 2;

      // Product Details Section
      sheet.getCell(currentRow, 1).value = "Product Details";
      sheet.getCell(currentRow, 1).font = { bold: true, size: 14 };
      currentRow += 2;

      // Product table headers
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
            "Verified Price"
      ];

      const headerRow = sheet.getRow(currentRow);
      productColumns.forEach((col, idx) => {
            headerRow.getCell(idx + 1).value = col;
      });
      headerRow.font = { bold: true };
      headerRow.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFD3D3D3" }
      };
      currentRow++;

      // Add product rows
      purchaseDetails.forEach(detail => {
            sheet.addRow([
                  detail.product_name,
                  detail.category_name,
                  detail.sub_category_name,
                  detail.warehouse_oid,
                  detail.aisle_oid,
                  detail.batch_code,
                  detail.ordered_quantity,
                  detail.verified_quantity,
                  detail.ordered_unit_price,
                  detail.verified_unit_price
            ]);
            currentRow++;
      });

      // Auto-size columns
      sheet.columns.forEach((col, idx) => {
            let max = 10;
            col.eachCell({ includeEmpty: true }, cell => {
                  const length = cell.value?.toString().length || 0;
                  max = Math.max(max, length + 2);
            });
            col.width = Math.min(max, 30); // Cap at 30 for better fit
      });

      return workbook.xlsx.writeBuffer();
};


module.exports = get_purchase_order_report;