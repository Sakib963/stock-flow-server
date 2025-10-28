const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const get_product_wise_stock_report = async (request, res) => {
      try {
            let data = await get_report_data(request);
            if (!data || data.length === 0) {
                  log.info("No Low stock report Found");
                  return res.status(404).json({
                        code: 404,
                        message: "No Low stock report Found",
                        data: null,
                  });
            }
            const buffer = await generate_product_wise_stock_xlsx(data);
            const timestamp = Date.now();
            const file_name = `product_wise_stock_report_${timestamp}.xlsx`;

            log.info(`Download product_wise_stock report - [${file_name}]`);

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
            SELECT
                  p.oid AS product_oid,
                  p.name AS product_name,
                  p.restock_threshold,
                  c.name AS category_name,
                  s.name AS sub_category_name,
                  i.oid AS inventory_oid,
                  i.batch_code,
                  i.initial_quantity,
                  i.quantity_available,
                  i.cost_price,
                  i.selling_price,
                  i.maximum_discount,
                  i.intended_use,
                  i.status
            FROM ${TABLE.PRODUCT} p
            INNER JOIN ${TABLE.INVENTORY} i ON i.product_oid = p.oid
            LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
            LEFT JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
            WHERE p.status = 'Active'
  `;

      // FILTER BY PRODUCT
      if (payload.product_oid && payload.product_oid.trim() !== '' && payload.product_oid.trim().toLowerCase() !== 'null') {
            query += ` AND p.oid = $${values.length + 1}`;
            values.push(payload.product_oid);
      }

      query += ` ORDER BY p.name, i.batch_code`;

      const sql = { text: query, values };
      return await get_data(sql);
};


const generate_product_wise_stock_xlsx = async (data) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Product Wise Stock");

      // Define column titles
      const columns = [
            "Product Name",
            "Category",
            "Sub Category",
            "Batch Code",
            "Initial Quantity",
            "Available Quantity",
            "Cost Price",
            "Selling Price",
            "Max Discount",
            "Status",
            "Restock Threshold",
      ];

      // Add header (logo + company + report title)
      addReportHeader(sheet, "Product Wise Stock Report", columns.length);

      // Column titles (row 5)
      const headerRowIndex = 5;
      sheet.addRow(columns);
      sheet.getRow(headerRowIndex).font = { bold: true };

      // Group rows by product
      let currentRow = headerRowIndex + 1;
      const grouped = data.reduce((acc, row) => {
            acc[row.product_oid] = acc[row.product_oid] || [];
            acc[row.product_oid].push(row);
            return acc;
      }, {});

      for (const productId in grouped) {
            const productRows = grouped[productId];
            const startRow = currentRow;

            productRows.forEach(r => {
                  sheet.addRow([
                        r.product_name,
                        r.category_name,
                        r.sub_category_name,
                        r.batch_code,
                        r.initial_quantity,
                        r.quantity_available,
                        r.cost_price,
                        r.selling_price,
                        r.maximum_discount,
                        r.status,
                        r.restock_threshold,
                  ]);
                  currentRow++;
            });

            const endRow = currentRow - 1;

            // Merge product-level columns (Product Name, Category, Sub Category, Restock Threshold)
            [1, 2, 3, 11].forEach(colIdx => {
                  if (startRow !== endRow) {
                        sheet.mergeCells(startRow, colIdx, endRow, colIdx);
                        sheet.getCell(startRow, colIdx).alignment = { vertical: "middle", horizontal: "center" };
                  }
            });
      }

      // Auto-size columns
      sheet.columns.forEach(col => {
            let max = 0;
            col.eachCell({ includeEmpty: true }, cell => {
                  max = Math.max(max, (cell.value?.toString().length || 0) + 2);
            });
            col.width = max;
      });

      return workbook.xlsx.writeBuffer();
};


module.exports = get_product_wise_stock_report;