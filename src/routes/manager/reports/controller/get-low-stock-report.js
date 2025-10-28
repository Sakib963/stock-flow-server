const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const get_low_stock_report = async (request, res) => {
      try {
            let data = await get_report_data(request);
            console.log(data.length);
            if (!data || data.length === 0) {
                  log.info("No Low stock report Found");
                  return res.status(404).json({
                        code: 404,
                        message: "No Low stock report Found",
                        data: null,
                  });
            }
            const buffer = await generate_low_stock_xlsx(data);
            const timestamp = Date.now();
            const file_name = `low_stock_report_${timestamp}.xlsx`;

            log.info(`Download low stock report - [${file_name}]`);

            res
                  .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                  .set("Content-Disposition", `attachment; filename="${file_name}"`)
                  .set("X-Filename", file_name)  // <-- new header
                  .set("Content-Length", buffer.length)
                  .send(buffer);


      } catch (error) {
            console.error("Error fetching low stock report:", error);
            res.status(500).json({ error: "Internal server error" });
      }
}

const get_report_data = async (request) => {
      let data = null;
      try {
            const payload = request.body;
            const values = [];

            let query = `
      SELECT 
        p.oid AS product_oid,
        p.name AS product_name,
        p.restock_threshold,
        c.name AS category_name,
        s.name AS sub_category_name,
        p.photo,
        COALESCE(COUNT(DISTINCT i.batch_code), 0) AS total_batches,
        COALESCE(SUM(i.quantity_available)::INTEGER, 0) AS total_available_quantity,
        bool_or(i.status = 'pending_pricing') AS has_pending_pricing,
        BOOL_OR(i.intended_use = 'for_sale') AS has_for_sale_batch
      FROM ${TABLE.PRODUCT} p
      INNER JOIN ${TABLE.INVENTORY} i ON i.product_oid = p.oid
      LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
      LEFT JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
      WHERE p.status = 'Active'
    `;

            // FILTER: CATEGORY
            if (payload.category_oid && payload.category_oid.trim() !== "" && payload.category_oid.trim().toLowerCase() !== "null") {
                  query += ` AND c.oid = $${values.length + 1}`;
                  values.push(payload.category_oid);
            }

            // FILTER: SUB CATEGORY
            if (payload.sub_category_oid && payload.sub_category_oid.trim() !== "" && payload.sub_category_oid.trim().toLowerCase() !== "null") {
                  query += ` AND s.oid = $${values.length + 1}`;
                  values.push(payload.sub_category_oid);
            }

            // GROUP
            query += ` GROUP BY p.oid, p.name, p.restock_threshold, p.photo, c.name, s.name`;

            // HAVING: only low stock products
            query += ` HAVING COALESCE(SUM(i.quantity_available)::INTEGER, 0) < p.restock_threshold`;

            // SORT
            query += ` ORDER BY p.name ASC`;

            const sql = { text: query, values };
            data = await get_data(sql);
      } catch (err) {
            log.error(`An exception occurred while getting low stock report information: ${err?.message}`);
            throw err;
      }
      return data;
};


const generate_low_stock_xlsx = async (data) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Low Stock");

      const titles = [
            "Product Name",
            "Total Batches",
            "Available Qty",
            "Has Pending Pricing",
            "Has For Sale Batch",
            "Restock Threshold",
            "Category",
            "Sub Category",
      ];

      // Add report header (logo + company info + title)
      addReportHeader(sheet, "Low Stock Report", titles.length);

      // Add column titles (bold)
      const headerRowIndex = 5; // Titles go on row 5
      sheet.addRow(titles); // adds to next row (row 5)
      sheet.getRow(headerRowIndex).font = { bold: true };

      // Add data rows
      data.forEach(r => {
            sheet.addRow([
                  r.product_name,
                  r.total_batches,
                  r.total_available_quantity,
                  r.has_pending_pricing ? "Yes" : "No",
                  r.has_for_sale_batch ? "Yes" : "No",
                  r.restock_threshold,
                  r.category_name,
                  r.sub_category_name,
            ]);
      });

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

module.exports = get_low_stock_report;