const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const generate_product_list_report_by_category = async (request, res) => {
      try {
            const payload = request.body;
            const categoryOid = payload.oid;

            if (!categoryOid) {
                  log.warn('Category OID is required');
                  return res.status(400).json({
                        code: 400,
                        message: "Category OID is required",
                        data: null,
                  });
            }

            // Get products with category details in a single query
            const productsSql = generate_products_sql(categoryOid);
            const products = await get_data(productsSql);

            if (!products || products.length === 0) {
                  log.info(`No products found for category OID: ${categoryOid}`);
                  return res.status(404).json({
                        code: 404,
                        message: "No products found for this category",
                        data: null,
                  });
            }

            // Extract category details from first row (same for all products)
            const categoryDetails = {
                  name: products[0].category_name,
                  description: products[0].category_description,
                  status: products[0].category_status,
                  category_code: products[0].category_code
            };
            
            const buffer = await generate_products_xlsx(products, categoryDetails);
            const timestamp = Date.now();
            const file_name = `${categoryDetails.name.replace(/\s+/g, '_')}_products_${timestamp}.xlsx`;

            log.info(`Download products list for category [${categoryDetails.name}] - [${file_name}]`);

            res
                  .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                  .set("Content-Disposition", `attachment; filename="${file_name}"`)
                  .set("X-Filename", file_name)
                  .set("Content-Length", buffer.length)
                  .send(buffer);
      } catch (e) {
            log.error(`An exception occurred while generating product list: ${e?.message}`);
            console.error(e);
            return res.status(500).json({ 
                  code: 500, 
                  message: "Something went wrong! Please try again later!" 
            });
      }
};

const generate_products_sql = (categoryOid) => {
      const query = `
            SELECT 
                  p.oid,
                  p.name AS product_name,
                  p.sku,
                  p.status,
                  p.restock_threshold,
                  p.unit_type,
                  s.name AS sub_category_name,
                  c.name AS category_name,
                  c.description AS category_description,
                  c.status AS category_status,
                  c.category_code,
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
            LEFT JOIN ${TABLE.INVENTORY} i ON i.product_oid = p.oid
            LEFT JOIN ${TABLE.SUB_CATEGORIES} s ON s.oid = p.sub_category_oid
            INNER JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
            LEFT JOIN ${TABLE.PRODUCT_STATS} ps ON ps.product_oid = p.oid
            WHERE p.category_oid = $1
            GROUP BY p.oid, p.name, p.sku, p.status, p.restock_threshold, p.unit_type, s.name, c.name, c.description, c.status, c.category_code, ps.total_sold, ps.total_returned
            ORDER BY p.name ASC
      `;
      return { text: query, values: [categoryOid] };
};

const generate_products_xlsx = async (products, categoryDetails) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Products");

      const titles = [
            "Product Name",
            "SKU",
            "Status",
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
      addReportHeader(sheet, `Products List - ${categoryDetails.name}`, titles.length);

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
      
      products.forEach(r => {
            totalProducts++;
            totalAvailableQty += parseInt(r.total_available_quantity || 0);
            totalInventoryValue += parseFloat(r.total_inventory_value || 0);
            totalQuantitySold += parseInt(r.total_quantity_sold || 0);
            totalQuantityReturned += parseInt(r.total_quantity_returned || 0);
            if (r.has_pending_pricing) productsWithPendingPricing++;
            if (r.has_for_sale_batch) productsWithForSale++;
            
            sheet.addRow([
                  r.product_name,
                  r.sku || 'N/A',
                  r.status,
                  r.sub_category_name || 'N/A',
                  r.unit_type || 'N/A',
                  r.total_batches,
                  r.total_available_quantity,
                  r.total_quantity_sold || 0,
                  r.total_quantity_returned || 0,
                  r.restock_threshold,
                  r.min_price,
                  r.max_price,
                  r.avg_price,
                  r.total_inventory_value,
                  r.has_pending_pricing ? 'Yes' : 'No',
                  r.has_for_sale_batch ? 'Yes' : 'No',
            ]);
      });

      // Add category details section
      sheet.addRow([]);
      sheet.addRow(['CATEGORY INFORMATION']);
      sheet.addRow(['Category Name:', categoryDetails.name]);
      sheet.addRow(['Category Code:', categoryDetails.category_code]);
      sheet.addRow(['Description:', categoryDetails.description || 'N/A']);
      sheet.addRow(['Status:', categoryDetails.status]);
      sheet.getRow(sheet.rowCount - 4).font = { bold: true, size: 12 };
      sheet.getRow(sheet.rowCount - 3).font = { bold: true };
      sheet.getRow(sheet.rowCount - 2).font = { bold: true };
      sheet.getRow(sheet.rowCount - 1).font = { bold: true };
      sheet.getRow(sheet.rowCount).font = { bold: true };

      // Add summary rows
      const summaryRowIndex = sheet.rowCount + 2;
      sheet.addRow([]);
      sheet.addRow([
            'PRODUCTS SUMMARY',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
      ]);
      sheet.addRow([
            'Total Products:',
            totalProducts,
      ]);
      sheet.addRow([
            'Total Available Quantity:',
            totalAvailableQty,
      ]);
      sheet.addRow([
            'Total Quantity Sold:',
            totalQuantitySold,
      ]);
      sheet.addRow([
            'Total Quantity Returned:',
            totalQuantityReturned,
      ]);
      sheet.addRow([
            'Total Inventory Value:',
            totalInventoryValue.toFixed(2),
      ]);
      sheet.addRow([
            'Products with Pending Pricing:',
            productsWithPendingPricing,
      ]);
      sheet.addRow([
            'Products Ready for Sale:',
            productsWithForSale,
      ]);
      
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
      sheet.columns.forEach(col => {
            let max = 0;
            col.eachCell({ includeEmpty: true }, cell => {
                  max = Math.max(max, (cell.value?.toString().length || 0) + 2);
            });
            col.width = max;
      });

      return workbook.xlsx.writeBuffer();
};

module.exports = generate_product_list_report_by_category;
