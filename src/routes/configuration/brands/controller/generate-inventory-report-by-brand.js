const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const generate_inventory_report_by_brand = async (request, res) => {
      try {
            const payload = request.body;
            const brandOid = payload.oid;
            
            if (!brandOid) {
                  log.warn('Brand OID is required');
                  return res.status(400).json({
                        code: 400,
                        message: "Brand OID is required",
                        data: null,
                  });
            }

            // Get inventory with sub-category details in a single query
            const inventorySql = generate_inventory_sql(brandOid);
            const inventory = await get_data(inventorySql);

            if (!inventory || inventory.length === 0) {
                  log.info(`No inventory found for brand OID: ${brandOid}`);
                  return res.status(404).json({
                        code: 404,
                        message: "No inventory data found for this brand",
                        data: null,
                  });
            }

            // Extract brand details from first row (same for all inventory items)
            const brandDetails = {
                  name: inventory[0].brand_name_detail,
                  description: inventory[0].brand_description,
                  status: inventory[0].brand_status
            };
            
            const buffer = await generate_inventory_xlsx(inventory, brandDetails);
            const timestamp = Date.now();
            const file_name = `${brandDetails.name.replace(/\s+/g, '_')}_inventory_report_${timestamp}.xlsx`;
            log.info(`Download inventory report for brand [${brandDetails.name}] - [${file_name}]`);
            res
                  .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                  .set("Content-Disposition", `attachment; filename="${file_name}"`)
                  .set("X-Filename", file_name)
                  .set("Access-Control-Expose-Headers", "X-Filename")
                  .set("Content-Length", buffer.length)
                  .send(buffer);
      } catch (e) {
            log.error(`An exception occurred while generating inventory report by brand: ${e?.message}`);
            console.error(e);
            return res.status(500).json({ 
                  code: 500, 
                  message: "Something went wrong! Please try again later!" 
            });
      }
};

const generate_inventory_sql = (brandOid) => {
      const query = `
            SELECT 
                  p.name AS product_name,
                  p.sku,
                  b.name AS brand_name_detail,
                  b.description AS brand_description,
                  b.status AS brand_status,
                  c.name AS category_name,
                  s.name AS sub_category_name,
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
                  sup.name AS supplier_name,
                  w.name AS warehouse_name,
                  a.name AS aisle_name
            FROM ${TABLE.INVENTORY} i
            INNER JOIN ${TABLE.PRODUCT} p ON p.oid = i.product_oid
            INNER JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid
            INNER JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
            LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = s.category_oid
            LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.oid = i.purchase_details_oid
            LEFT JOIN ${TABLE.PURCHASE} pu ON pu.oid = pd.purchase_oid
            LEFT JOIN ${TABLE.SUPPLIER} sup ON sup.oid = pu.supplier_oid
            LEFT JOIN ${TABLE.WAREHOUSE} w ON w.oid = pd.warehouse_oid
            LEFT JOIN ${TABLE.AISLE} a ON a.oid = pd.aisle_oid
            WHERE p.brand_oid = $1
            ORDER BY p.name ASC, i.batch_code ASC
      `;
      return { text: query, values: [brandOid] };
};

const generate_inventory_xlsx = async (inventory, brandDetails) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Inventory");

      const titles = [
            "Product Name",
            "SKU",
            "Category",
            "Sub Category",
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
            "Warehouse",
            "Aisle",
            "Purchase Date",
            "Batch Created",
      ];

      // Add report header (logo + company info + title)
      addReportHeader(sheet, `Inventory Report - ${brandDetails.name}`, titles.length);

      // Add column titles (bold)
      const headerRowIndex = 5; // Titles go on row 5
      sheet.addRow(titles); // adds to next row (row 5)
      sheet.getRow(headerRowIndex).font = { bold: true };

      // Add data rows
      let totalInventoryValue = 0;
      let totalCostValue = 0;
      inventory.forEach(r => {
            totalInventoryValue += parseFloat(r.inventory_value || 0);
            totalCostValue += parseFloat(r.cost_value || 0);
            sheet.addRow([
                  r.product_name,
                  r.sku || 'N/A',
                  r.category_name || 'N/A',
                  r.sub_category_name || 'N/A',
                  r.batch_code,
                  r.initial_quantity,
                  r.quantity_available,
                  r.cost_price,
                  r.selling_price,
                  r.inventory_value,
                  r.cost_value,
                  r.maximum_discount || 0,
                  r.batch_status,
                  r.intended_use || 'N/A',
                  r.supplier_name || 'N/A',
                  r.warehouse_name || 'N/A',
                  r.aisle_name || 'N/A',
                  r.purchase_date || 'N/A',
                  r.batch_created_date || 'N/A',
            ]);
      });

      // Add brand details section
      sheet.addRow([]);
      sheet.addRow(['BRAND INFORMATION']);
      sheet.addRow(['Brand Name:', brandDetails.name]);
      sheet.addRow(['Description:', brandDetails.description || 'N/A']);
      sheet.addRow(['Status:', brandDetails.status]);
      sheet.getRow(sheet.rowCount - 3).font = { bold: true };
      sheet.getRow(sheet.rowCount - 2).font = { bold: true };
      sheet.getRow(sheet.rowCount - 1).font = { bold: true };
      sheet.getRow(sheet.rowCount).font = { bold: true };

      // Add summary rows
      const summaryRowIndex = sheet.rowCount + 2;
      sheet.addRow([]);
      sheet.addRow([
            'Total Cost Value:',
            '',
            totalCostValue.toFixed(2),
      ]);
      sheet.addRow([
            'Total Inventory Value (Selling Price):',
            '',
            totalInventoryValue.toFixed(2),
      ]);
      sheet.addRow([
            'Potential Profit:',
            '',
            (totalInventoryValue - totalCostValue).toFixed(2),
      ]);
      sheet.getRow(summaryRowIndex + 1).font = { bold: true };
      sheet.getRow(summaryRowIndex + 2).font = { bold: true };
      sheet.getRow(summaryRowIndex + 3).font = { bold: true };

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

module.exports = generate_inventory_report_by_brand;
