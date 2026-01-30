const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../utils/database");
const { log } = require("../../../../utils/log");
const ExcelJS = require("exceljs");
const { addReportHeader } = require("../../../../utils/report-header");

const generate_supplier_performance_report = async (request, res) => {
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

            // Get supplier details
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

            // Get purchase orders for this supplier
            const purchaseOrdersSql = generate_purchase_orders_sql(supplierOid);
            const purchaseOrders = await get_data(purchaseOrdersSql);

            // Get products from this supplier
            const productsSql = generate_products_sql(supplierOid);
            const products = await get_data(productsSql);
            
            const buffer = await generate_performance_xlsx(supplierDetails, purchaseOrders, products);
            const timestamp = Date.now();
            const file_name = `${supplierDetails.name.replace(/\s+/g, '_')}_performance_report_${timestamp}.xlsx`;

            log.info(`Download supplier performance report for [${supplierDetails.name}] - [${file_name}]`);

            res
                  .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                  .set("Content-Disposition", `attachment; filename="${file_name}"`)
                  .set("X-Filename", file_name)
                  .set("Access-Control-Expose-Headers", "X-Filename")
                  .set("Content-Length", buffer.length)
                  .send(buffer);
      } catch (e) {
            log.error(`An exception occurred while generating supplier performance report: ${e?.message}`);
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
                  s.name,
                  s.contact_person,
                  s.phone_number,
                  s.email,
                  s.address,
                  s.status,
                  COUNT(DISTINCT pd.product_oid) as total_products,
                  COUNT(DISTINCT po.oid) as total_orders,
                  COUNT(DISTINCT CASE WHEN po.status = 'Pending' THEN po.oid END) as active_orders,
                  COUNT(DISTINCT CASE WHEN po.status = 'Completed' OR po.verified_on IS NOT NULL THEN po.oid END) as completed_orders,
                  ROUND(COALESCE(SUM(po.total_amount), 0)::numeric, 2) as total_purchase_value,
                  ROUND(COALESCE(SUM(pd.ordered_quantity * pd.ordered_unit_price), 0)::numeric, 2) as total_ordered_cost,
                  ROUND(COALESCE(SUM(pd.verified_quantity * pd.verified_unit_price), 0)::numeric, 2) as total_verified_cost
            FROM ${TABLE.SUPPLIER} s
            LEFT JOIN ${TABLE.PURCHASE} po ON po.supplier_oid = s.oid
            LEFT JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.purchase_oid = po.oid
            WHERE s.oid = $1
            GROUP BY s.name, s.contact_person, s.phone_number, s.email, s.address, s.status
      `;
      return { text: query, values: [supplierOid] };
};

const generate_purchase_orders_sql = (supplierOid) => {
      const query = `
            SELECT 
                  po.oid,
                  po.created_on as order_date,
                  po.verified_on as verification_date,
                  po.status,
                  po.purchase_type,
                  po.payment_status,
                  po.total_amount,
                  po.paid_amount,
                  CASE 
                        WHEN po.verified_on IS NOT NULL AND po.created_on IS NOT NULL
                        THEN EXTRACT(DAY FROM (po.verified_on - po.created_on))
                        ELSE NULL
                  END as processing_days,
                  COUNT(DISTINCT pod.product_oid) as products_count,
                  SUM(pod.ordered_quantity) as total_ordered_qty,
                  SUM(pod.verified_quantity) as total_verified_qty,
                  ROUND(SUM(pod.ordered_quantity * pod.ordered_unit_price)::numeric, 2) as ordered_value,
                  ROUND(SUM(COALESCE(pod.verified_quantity, 0) * COALESCE(pod.verified_unit_price, pod.ordered_unit_price))::numeric, 2) as verified_value,
                  ROUND((SUM(COALESCE(pod.verified_quantity, 0))::numeric / NULLIF(SUM(pod.ordered_quantity), 0) * 100), 2) as verification_rate
            FROM ${TABLE.PURCHASE} po
            LEFT JOIN ${TABLE.PURCHASE_DETAILS} pod ON pod.purchase_oid = po.oid
            WHERE po.supplier_oid = $1
            GROUP BY po.oid, po.created_on, po.verified_on, po.status, po.purchase_type, po.payment_status, po.total_amount, po.paid_amount
            ORDER BY po.created_on DESC
      `;
      return { text: query, values: [supplierOid] };
};

const generate_products_sql = (supplierOid) => {
      const query = `
            SELECT 
                  p.name AS product_name,
                  p.sku,
                  p.status,
                  c.name AS category_name,
                  -- Purchase Cost Analysis
                  ROUND(COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price))::numeric, 2) as avg_purchase_price,
                  SUM(COALESCE(pd.verified_quantity, pd.ordered_quantity)) as total_purchased_qty,
                  -- Current Inventory
                  COALESCE(SUM(CAST(i.quantity_available AS INTEGER)), 0) AS current_stock,
                  ROUND(COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0), 2) AS avg_selling_price,
                  -- Profit Analysis
                  ROUND(COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0) - COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price)), 2) as unit_profit,
                  ROUND((COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0) - COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price))) * 100.0 / NULLIF(COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price)), 0), 2) as profit_margin_pct,
                  -- Sales Performance
                  COALESCE(ps.total_sold, 0) AS total_quantity_sold,
                  COALESCE(ps.total_returned, 0) AS total_quantity_returned,
                  ROUND(COALESCE(ps.total_sold, 0) * COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0), 2) as total_revenue,
                  ROUND(COALESCE(ps.total_sold, 0) * (COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0) - COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price))), 2) as total_profit,
                  -- Demand Indicator
                  ROUND((COALESCE(ps.total_sold, 0)::numeric / NULLIF(SUM(COALESCE(pd.verified_quantity, pd.ordered_quantity)), 0) * 100), 2) as sales_rate_pct
            FROM ${TABLE.PRODUCT} p
            INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.product_oid = p.oid
            INNER JOIN ${TABLE.PURCHASE} pu ON pu.oid = pd.purchase_oid AND pu.supplier_oid = $1
            LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
            LEFT JOIN ${TABLE.INVENTORY} i ON i.product_oid = p.oid AND i.status IN ('ready_for_sale', 'pending_pricing')
            LEFT JOIN ${TABLE.PRODUCT_STATS} ps ON ps.product_oid = p.oid
            WHERE p.is_deleted = FALSE
            GROUP BY p.name, p.sku, p.status, c.name, ps.total_sold, ps.total_returned
            ORDER BY total_profit DESC NULLS LAST, total_quantity_sold DESC
      `;
      return { text: query, values: [supplierOid] };
};

const generate_performance_xlsx = async (supplierDetails, purchaseOrders, products) => {
      const workbook = new ExcelJS.Workbook();
      
      // Sheet 1: Supplier Overview
      const overviewSheet = workbook.addWorksheet("Supplier Overview");
      addReportHeader(overviewSheet, `Supplier Performance Report - ${supplierDetails.name}`, 2);
      
      overviewSheet.getColumn(1).width = 25;
      overviewSheet.getColumn(2).width = 40;
      
      const overviewStartRow = 5;
      overviewSheet.getRow(overviewStartRow).values = ["Field", "Value"];
      overviewSheet.getRow(overviewStartRow).font = { bold: true };
      
      overviewSheet.addRow(["Supplier Name", supplierDetails.name]);
      overviewSheet.addRow(["Contact Person", supplierDetails.contact_person || 'N/A']);
      overviewSheet.addRow(["Phone", supplierDetails.phone_number || 'N/A']);
      overviewSheet.addRow(["Email", supplierDetails.email || 'N/A']);
      overviewSheet.addRow(["Address", supplierDetails.address || 'N/A']);
      overviewSheet.addRow(["Status", supplierDetails.status]);
      overviewSheet.addRow(["", ""]);
      overviewSheet.addRow(["Performance Metrics", ""]).font = { bold: true };
      overviewSheet.addRow(["Total Products Supplied", parseInt(supplierDetails.total_products || 0)]);
      overviewSheet.addRow(["Total Purchase Orders", parseInt(supplierDetails.total_orders || 0)]);
      overviewSheet.addRow(["Active Orders", parseInt(supplierDetails.active_orders || 0)]);
      overviewSheet.addRow(["Completed Orders", parseInt(supplierDetails.completed_orders || 0)]);
      overviewSheet.addRow(["Total Purchase Value", `$${parseFloat(supplierDetails.total_purchase_value || 0).toFixed(2)}`]);
      overviewSheet.addRow(["Total Ordered Cost", `$${parseFloat(supplierDetails.total_ordered_cost || 0).toFixed(2)}`]);
      overviewSheet.addRow(["Total Verified Cost", `$${parseFloat(supplierDetails.total_verified_cost || 0).toFixed(2)}`]);
      
      const costVariance = parseFloat(supplierDetails.total_ordered_cost || 0) - parseFloat(supplierDetails.total_verified_cost || 0);
      overviewSheet.addRow(["Cost Variance (Ordered - Verified)", `$${costVariance.toFixed(2)}`]);

      // Sheet 2: Purchase Orders
      const ordersSheet = workbook.addWorksheet("Purchase Orders");
      const orderTitles = [
            "Order Date",
            "Verification Date",
            "Status",
            "Type",
            "Payment Status",
            "Products Count",
            "Ordered Qty",
            "Verified Qty",
            "Verification %",
            "Ordered Value",
            "Verified Value",
            "Total Amount",
            "Paid Amount",
            "Processing Days"
      ];
      
      addReportHeader(ordersSheet, "Purchase Orders", orderTitles.length);
      ordersSheet.addRow(orderTitles);
      ordersSheet.getRow(5).font = { bold: true };

      let totalOrders = 0;
      let totalOrderedQty = 0;
      let totalVerifiedQty = 0;
      let totalOrderedValue = 0;
      let totalVerifiedValue = 0;
      let totalAmount = 0;
      let totalPaid = 0;
      let totalProcessingDays = 0;
      let ordersWithDates = 0;

      purchaseOrders.forEach(po => {
            totalOrders++;
            totalOrderedQty += parseInt(po.total_ordered_qty || 0);
            totalVerifiedQty += parseInt(po.total_verified_qty || 0);
            totalOrderedValue += parseFloat(po.ordered_value || 0);
            totalVerifiedValue += parseFloat(po.verified_value || 0);
            totalAmount += parseFloat(po.total_amount || 0);
            totalPaid += parseFloat(po.paid_amount || 0);
            
            if (po.processing_days !== null) {
                  totalProcessingDays += parseFloat(po.processing_days);
                  ordersWithDates++;
            }

            ordersSheet.addRow([
                  po.order_date ? new Date(po.order_date).toLocaleDateString() : 'N/A',
                  po.verification_date ? new Date(po.verification_date).toLocaleDateString() : 'Pending',
                  po.status,
                  po.purchase_type || 'N/A',
                  po.payment_status || 'N/A',
                  parseInt(po.products_count || 0),
                  parseInt(po.total_ordered_qty || 0),
                  parseInt(po.total_verified_qty || 0),
                  po.verification_rate ? `${parseFloat(po.verification_rate).toFixed(1)}%` : 'N/A',
                  parseFloat(po.ordered_value || 0).toFixed(2),
                  parseFloat(po.verified_value || 0).toFixed(2),
                  parseFloat(po.total_amount || 0).toFixed(2),
                  parseFloat(po.paid_amount || 0).toFixed(2),
                  po.processing_days !== null ? parseFloat(po.processing_days).toFixed(1) : 'N/A'
            ]);
      });

      // Add summary row
      ordersSheet.addRow([]);
      const summaryRow = ordersSheet.addRow([
            "SUMMARY",
            "",
            `${totalOrders} Orders`,
            "",
            "",
            "",
            totalOrderedQty,
            totalVerifiedQty,
            totalOrderedQty > 0 ? `${((totalVerifiedQty / totalOrderedQty) * 100).toFixed(1)}%` : 'N/A',
            totalOrderedValue.toFixed(2),
            totalVerifiedValue.toFixed(2),
            totalAmount.toFixed(2),
            totalPaid.toFixed(2),
            ordersWithDates > 0 ? (totalProcessingDays / ordersWithDates).toFixed(1) : 'N/A'
      ]);
      summaryRow.font = { bold: true };

      // Sheet 3: Products Performance & Profitability
      const productsSheet = workbook.addWorksheet("Products Performance");
      const productTitles = [
            "Product Name",
            "SKU",
            "Category",
            "Status",
            "Purchased Qty",
            "Current Stock",
            "Sold Qty",
            "Returned Qty",
            "Sales Rate %",
            "Avg Purchase Price",
            "Avg Selling Price",
            "Unit Profit",
            "Profit Margin %",
            "Total Revenue",
            "Total Profit"
      ];
      
      addReportHeader(productsSheet, "Products Performance & Profitability Analysis", productTitles.length);
      productsSheet.addRow(productTitles);
      productsSheet.getRow(5).font = { bold: true };

      let totalPurchasedQty = 0;
      let totalCurrentStock = 0;
      let totalSold = 0;
      let totalReturned = 0;
      let totalRevenue = 0;
      let totalProfit = 0;

      products.forEach(p => {
            totalPurchasedQty += parseInt(p.total_purchased_qty || 0);
            totalCurrentStock += parseInt(p.current_stock || 0);
            totalSold += parseInt(p.total_quantity_sold || 0);
            totalReturned += parseInt(p.total_quantity_returned || 0);
            totalRevenue += parseFloat(p.total_revenue || 0);
            totalProfit += parseFloat(p.total_profit || 0);

            productsSheet.addRow([
                  p.product_name,
                  p.sku,
                  p.category_name || 'N/A',
                  p.status,
                  parseInt(p.total_purchased_qty || 0),
                  parseInt(p.current_stock || 0),
                  parseInt(p.total_quantity_sold || 0),
                  parseInt(p.total_quantity_returned || 0),
                  p.sales_rate_pct ? `${parseFloat(p.sales_rate_pct).toFixed(1)}%` : 'N/A',
                  parseFloat(p.avg_purchase_price || 0).toFixed(2),
                  parseFloat(p.avg_selling_price || 0).toFixed(2),
                  parseFloat(p.unit_profit || 0).toFixed(2),
                  p.profit_margin_pct ? `${parseFloat(p.profit_margin_pct).toFixed(1)}%` : 'N/A',
                  parseFloat(p.total_revenue || 0).toFixed(2),
                  parseFloat(p.total_profit || 0).toFixed(2)
            ]);
      });

      // Add summary row
      productsSheet.addRow([]);
      const productSummaryRow = productsSheet.addRow([
            "SUMMARY",
            `${products.length} Products`,
            "",
            "",
            totalPurchasedQty,
            totalCurrentStock,
            totalSold,
            totalReturned,
            totalPurchasedQty > 0 ? `${((totalSold / totalPurchasedQty) * 100).toFixed(1)}%` : 'N/A',
            "",
            "",
            "",
            totalRevenue > 0 ? `${((totalProfit / totalRevenue) * 100).toFixed(1)}%` : 'N/A',
            totalRevenue.toFixed(2),
            totalProfit.toFixed(2)
      ]);
      productSummaryRow.font = { bold: true };

      // Auto-fit columns
      [overviewSheet, ordersSheet, productsSheet].forEach(sheet => {
            sheet.columns.forEach(column => {
                  if (!column.width) {
                        column.width = 15;
                  }
            });
      });

      return await workbook.xlsx.writeBuffer();
};

module.exports = generate_supplier_performance_report;
