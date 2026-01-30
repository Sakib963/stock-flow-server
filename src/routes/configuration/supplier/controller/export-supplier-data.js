const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const export_supplier_data = async (request, res) => {
      try {
            const payload = request.body;
            const supplierOid = payload.oid;

            if (!supplierOid) {
                  log.warn('Supplier OID is required');
                  return res.status(400).json({
                        code: 400,
                        message: "Supplier OID is required",
                        data: null,
                  });
            }

            // Get supplier details with all related data
            const supplierSql = generate_supplier_sql(supplierOid);
            const suppliers = await get_data(supplierSql);

            if (!suppliers || suppliers.length === 0) {
                  log.info(`No supplier found for OID: ${supplierOid}`);
                  return res.status(404).json({
                        code: 404,
                        message: "Supplier not found",
                        data: null,
                  });
            }

            const supplierDetails = suppliers[0];

            // Get all products from this supplier with detailed info
            const productsSql = generate_products_detailed_sql(supplierOid);
            const products = await get_data(productsSql);

            // Get purchase history
            const purchaseHistorySql = generate_purchase_history_sql(supplierOid);
            const purchaseHistory = await get_data(purchaseHistorySql);
            
            const buffer = await generate_export_xlsx(supplierDetails, products, purchaseHistory);
            const timestamp = Date.now();
            const file_name = `${supplierDetails.name.replace(/\s+/g, '_')}_export_${timestamp}.xlsx`;

            log.info(`Export supplier data for [${supplierDetails.name}] - [${file_name}]`);

            res
                  .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                  .set("Content-Disposition", `attachment; filename="${file_name}"`)
                  .set("X-Filename", file_name)
                  .set("Access-Control-Expose-Headers", "X-Filename")
                  .set("Content-Length", buffer.length)
                  .send(buffer);
      } catch (e) {
            log.error(`An exception occurred while exporting supplier data: ${e?.message}`);
            console.error(e);
            return res.status(500).json({ 
                  code: 500, 
                  message: "Something went wrong! Please try again later!" 
            });
      }
};

const generate_supplier_sql = (supplierOid) => {
      const query = `
            SELECT 
                  s.*,
                  COUNT(DISTINCT pd.product_oid) as total_products,
                  COUNT(DISTINCT po.oid) as total_orders
            FROM ${TABLE.SUPPLIER} s
            LEFT JOIN ${TABLE.PURCHASE} po ON po.supplier_oid = s.oid
            LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.purchase_oid = po.oid
            WHERE s.oid = $1
            GROUP BY s.oid
      `;
      return { text: query, values: [supplierOid] };
};

const generate_products_detailed_sql = (supplierOid) => {
      const query = `
            SELECT 
                  p.oid,
                  p.name AS product_name,
                  p.sku,
                  p.description,
                  p.status,
                  p.unit_type,
                  p.restock_threshold,
                  c.name AS category_name,
                  sc.name AS sub_category_name,
                  b.name AS brand_name,
                  COALESCE(SUM(CAST(i.quantity_available AS INTEGER)), 0) AS total_available_quantity,
                  ROUND(COALESCE(MIN(CAST(i.selling_price AS NUMERIC)), 0), 2) AS min_price,
                  ROUND(COALESCE(MAX(CAST(i.selling_price AS NUMERIC)), 0), 2) AS max_price,
                  ROUND(COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0), 2) AS avg_price,
                  ROUND(COALESCE(SUM(CAST(i.quantity_available AS INTEGER) * CAST(COALESCE(i.selling_price, 0) AS NUMERIC)), 0), 2) AS inventory_value,
                  COALESCE(ps.total_sold, 0) AS total_quantity_sold,
                  COALESCE(ps.total_returned, 0) AS total_quantity_returned,
                  p.created_on,
                  p.created_by
            FROM ${TABLE.PRODUCT} p
            INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.product_oid = p.oid
            INNER JOIN ${TABLE.PURCHASE} pu ON pu.oid = pd.purchase_oid AND pu.supplier_oid = $1
            LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
            LEFT JOIN ${TABLE.SUB_CATEGORIES} sc ON sc.oid = p.sub_category_oid
            LEFT JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid
            LEFT JOIN ${TABLE.INVENTORY} i ON i.product_oid = p.oid AND i.status IN ('ready_for_sale', 'pending_pricing')
            LEFT JOIN ${TABLE.PRODUCT_STATS} ps ON ps.product_oid = p.oid
            WHERE p.is_deleted = FALSE
            GROUP BY p.oid, p.name, p.sku, p.description, p.status, p.unit_type, p.restock_threshold,
                     c.name, sc.name, b.name, ps.total_sold, ps.total_returned, p.created_on, p.created_by
            ORDER BY p.name ASC
      `;
      return { text: query, values: [supplierOid] };
};

const generate_purchase_history_sql = (supplierOid) => {
      const query = `
            SELECT 
                  po.oid,
                  po.created_on as order_date,
                  po.status,
                  po.total_amount,
                  po.special_notes as notes,
                  po.purchase_type,
                  po.payment_status,
                  po.created_by,
                  po.created_on,
                  COUNT(DISTINCT pod.product_oid) as products_count,
                  SUM(pod.ordered_quantity) as total_quantity,
                  STRING_AGG(DISTINCT pr.name, ', ') as product_names
            FROM ${TABLE.PURCHASE} po
            LEFT JOIN ${TABLE.PURCHASE_DETAILS} pod ON pod.purchase_oid = po.oid
            LEFT JOIN ${TABLE.PRODUCT} pr ON pr.oid = pod.product_oid
            WHERE po.supplier_oid = $1
            GROUP BY po.oid, po.created_on, po.status, po.total_amount, po.special_notes, 
                     po.purchase_type, po.payment_status, po.created_by, po.created_on
            ORDER BY po.created_on DESC
      `;
      return { text: query, values: [supplierOid] };
};

const generate_export_xlsx = async (supplierDetails, products, purchaseHistory) => {
      const workbook = new ExcelJS.Workbook();
      
      // Sheet 1: Supplier Information
      const infoSheet = workbook.addWorksheet("Supplier Information");
      addReportHeader(infoSheet, `Supplier Data Export - ${supplierDetails.name}`, 2);
      
      infoSheet.getColumn(1).width = 25;
      infoSheet.getColumn(2).width = 50;
      
      const infoStartRow = 5;
      infoSheet.getRow(infoStartRow).values = ["Field", "Value"];
      infoSheet.getRow(infoStartRow).font = { bold: true };
      
      infoSheet.addRow(["Supplier OID", supplierDetails.oid]);
      infoSheet.addRow(["Supplier Name", supplierDetails.name]);
      infoSheet.addRow(["Contact Person", supplierDetails.contact_person || 'N/A']);
      infoSheet.addRow(["Phone", supplierDetails.phone_number || 'N/A']);
      infoSheet.addRow(["Email", supplierDetails.email || 'N/A']);
      infoSheet.addRow(["Address", supplierDetails.address || 'N/A']);
      infoSheet.addRow(["Status", supplierDetails.status]);
      infoSheet.addRow(["Total Products", parseInt(supplierDetails.total_products || 0)]);
      infoSheet.addRow(["Total Purchase Orders", parseInt(supplierDetails.total_orders || 0)]);
      infoSheet.addRow(["Created By", supplierDetails.created_by]);
      infoSheet.addRow(["Created On", supplierDetails.created_on ? new Date(supplierDetails.created_on).toLocaleString() : 'N/A']);
      infoSheet.addRow(["Last Edited By", supplierDetails.edited_by || 'N/A']);
      infoSheet.addRow(["Last Edited On", supplierDetails.edited_on ? new Date(supplierDetails.edited_on).toLocaleString() : 'N/A']);

      // Sheet 2: Products
      const productsSheet = workbook.addWorksheet("Products");
      const productTitles = [
            "Product OID",
            "Product Name",
            "SKU",
            "Description",
            "Category",
            "Sub Category",
            "Brand",
            "Status",
            "Unit Type",
            "Restock Threshold",
            "Available Qty",
            "Min Price",
            "Max Price",
            "Avg Price",
            "Inventory Value",
            "Qty Sold",
            "Qty Returned",
            "Created By",
            "Created On"
      ];
      
      addReportHeader(productsSheet, "Supplier Products", productTitles.length);
      productsSheet.addRow(productTitles);
      productsSheet.getRow(5).font = { bold: true };

      let totalInventoryValue = 0;
      let totalAvailableQty = 0;
      let totalSold = 0;
      let totalReturned = 0;

      products.forEach(p => {
            totalInventoryValue += parseFloat(p.inventory_value || 0);
            totalAvailableQty += parseInt(p.total_available_quantity || 0);
            totalSold += parseInt(p.total_quantity_sold || 0);
            totalReturned += parseInt(p.total_quantity_returned || 0);

            productsSheet.addRow([
                  p.oid,
                  p.product_name,
                  p.sku,
                  p.description || 'N/A',
                  p.category_name || 'N/A',
                  p.sub_category_name || 'N/A',
                  p.brand_name || 'N/A',
                  p.status,
                  p.unit_type || 'N/A',
                  parseInt(p.restock_threshold || 0),
                  parseInt(p.total_available_quantity || 0),
                  parseFloat(p.min_price || 0).toFixed(2),
                  parseFloat(p.max_price || 0).toFixed(2),
                  parseFloat(p.avg_price || 0).toFixed(2),
                  parseFloat(p.inventory_value || 0).toFixed(2),
                  parseInt(p.total_quantity_sold || 0),
                  parseInt(p.total_quantity_returned || 0),
                  p.created_by,
                  p.created_on ? new Date(p.created_on).toLocaleDateString() : 'N/A'
            ]);
      });

      // Add summary row
      productsSheet.addRow([]);
      const productSummaryRow = productsSheet.addRow([
            "SUMMARY",
            `Total: ${products.length} Products`,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            totalAvailableQty,
            "",
            "",
            "",
            totalInventoryValue.toFixed(2),
            totalSold,
            totalReturned,
            "",
            ""
      ]);
      productSummaryRow.font = { bold: true };

      // Sheet 3: Purchase History
      const historySheet = workbook.addWorksheet("Purchase History");
      const historyTitles = [
            "Purchase ID",
            "Order Date",
            "Status",
            "Purchase Type",
            "Payment Status",
            "Total Amount",
            "Products Count",
            "Total Quantity",
            "Product Names",
            "Notes",
            "Created By",
            "Created On"
      ];
      
      addReportHeader(historySheet, "Purchase Order History", historyTitles.length);
      historySheet.addRow(historyTitles);
      historySheet.getRow(5).font = { bold: true };

      let totalPurchaseAmount = 0;

      purchaseHistory.forEach(po => {
            totalPurchaseAmount += parseFloat(po.total_amount || 0);

            historySheet.addRow([
                  po.oid.substring(0, 12) + '...',
                  po.order_date ? new Date(po.order_date).toLocaleDateString() : 'N/A',
                  po.status,
                  po.purchase_type || 'N/A',
                  po.payment_status || 'N/A',
                  parseFloat(po.total_amount || 0).toFixed(2),
                  parseInt(po.products_count || 0),
                  parseInt(po.total_quantity || 0),
                  po.product_names || 'N/A',
                  po.notes || '',
                  po.created_by,
                  po.created_on ? new Date(po.created_on).toLocaleDateString() : 'N/A'
            ]);
      });

      // Add summary row
      historySheet.addRow([]);
      const historySummaryRow = historySheet.addRow([
            "SUMMARY",
            `Total: ${purchaseHistory.length} Orders`,
            "",
            "",
            "",
            totalPurchaseAmount.toFixed(2),
            "",
            "",
            "",
            "",
            "",
            ""
      ]);
      historySummaryRow.font = { bold: true };

      // Auto-fit columns
      [infoSheet, productsSheet, historySheet].forEach(sheet => {
            sheet.columns.forEach(column => {
                  if (!column.width) {
                        column.width = 15;
                  }
            });
      });

      return await workbook.xlsx.writeBuffer();
};

module.exports = export_supplier_data;
