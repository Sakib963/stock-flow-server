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
      log.warn("Supplier OID is required");
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

    const buffer = await generate_performance_xlsx(
      supplierDetails,
      purchaseOrders,
      products,
    );
    const timestamp = Date.now();
    const file_name = `${supplierDetails.name.replace(/\s+/g, "_")}_performance_report_${timestamp}.xlsx`;
    const file_name_ascii = file_name.replace(/[^\x00-\x7F]/g, "");
    const file_name_encoded = encodeURIComponent(file_name);

    log.info(
      `Download supplier performance report for [${supplierDetails.name}] - [${file_name}]`,
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
      `An exception occurred while generating supplier performance report: ${e?.message}`,
    );
    console.error(e);
    return res.status(500).json({
      code: 500,
      message: "Something went wrong! Please try again later!",
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
                  -- Supplier-Specific Purchase Data
                  SUM(COALESCE(pd.verified_quantity, pd.ordered_quantity)) as qty_purchased_from_supplier,
                  COUNT(DISTINCT pu.oid) as purchase_order_count,
                  MIN(pu.created_on) as first_purchase_date,
                  MAX(pu.created_on) as last_purchase_date,
                  ROUND(COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price))::numeric, 2) as avg_purchase_price_from_supplier,
                  ROUND(COALESCE(MIN(pd.verified_unit_price), MIN(pd.ordered_unit_price))::numeric, 2) as lowest_purchase_price,
                  ROUND(COALESCE(MAX(pd.verified_unit_price), MAX(pd.ordered_unit_price))::numeric, 2) as highest_purchase_price,
                  -- Current Market Data (All Sources)
                  ROUND(COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0), 2) AS current_avg_selling_price,
                  -- Potential Profit Analysis (Based on Supplier's Purchase Price vs Current Selling Price)
                  ROUND(COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0) - COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price)), 2) as potential_profit_per_unit,
                  ROUND((COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0) - COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price))) * 100.0 / NULLIF(COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price)), 0), 2) as markup_percentage,
                  ROUND(SUM(COALESCE(pd.verified_quantity, pd.ordered_quantity)) * (COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0) - COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price))), 2) as estimated_potential_profit
            FROM ${TABLE.PRODUCT} p
            INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.product_oid = p.oid
            INNER JOIN ${TABLE.PURCHASE} pu ON pu.oid = pd.purchase_oid AND pu.supplier_oid = $1
            LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
            LEFT JOIN ${TABLE.INVENTORY} i ON i.product_oid = p.oid AND i.status IN ('ready_for_sale', 'pending_pricing')
            WHERE p.is_deleted = FALSE
            GROUP BY p.name, p.sku, p.status, c.name
            ORDER BY estimated_potential_profit DESC NULLS LAST, qty_purchased_from_supplier DESC
      `;
  return { text: query, values: [supplierOid] };
};

const generate_performance_xlsx = async (
  supplierDetails,
  purchaseOrders,
  products,
) => {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Supplier Overview
  const overviewSheet = workbook.addWorksheet("Supplier Overview");
  addReportHeader(
    overviewSheet,
    `Supplier Performance Report - ${supplierDetails.name}`,
    2,
  );

  overviewSheet.getColumn(1).width = 25;
  overviewSheet.getColumn(2).width = 40;

  const overviewStartRow = 5;
  overviewSheet.getRow(overviewStartRow).values = ["Field", "Value"];
  overviewSheet.getRow(overviewStartRow).font = { bold: true };

  overviewSheet.addRow(["Supplier Name", supplierDetails.name]);
  overviewSheet.addRow([
    "Contact Person",
    supplierDetails.contact_person || "N/A",
  ]);
  overviewSheet.addRow(["Phone", supplierDetails.phone_number || "N/A"]);
  overviewSheet.addRow(["Email", supplierDetails.email || "N/A"]);
  overviewSheet.addRow(["Address", supplierDetails.address || "N/A"]);
  overviewSheet.addRow(["Status", supplierDetails.status]);
  overviewSheet.addRow(["", ""]);
  overviewSheet.addRow(["Performance Metrics", ""]).font = { bold: true };
  overviewSheet.addRow([
    "Total Products Supplied",
    parseInt(supplierDetails.total_products || 0),
  ]);
  overviewSheet.addRow([
    "Total Purchase Orders",
    parseInt(supplierDetails.total_orders || 0),
  ]);
  overviewSheet.addRow([
    "Active Orders",
    parseInt(supplierDetails.active_orders || 0),
  ]);
  overviewSheet.addRow([
    "Completed Orders",
    parseInt(supplierDetails.completed_orders || 0),
  ]);
  overviewSheet.addRow([
    "Total Purchase Value",
    `$${parseFloat(supplierDetails.total_purchase_value || 0).toFixed(2)}`,
  ]);
  overviewSheet.addRow([
    "Total Ordered Cost",
    `$${parseFloat(supplierDetails.total_ordered_cost || 0).toFixed(2)}`,
  ]);
  overviewSheet.addRow([
    "Total Verified Cost",
    `$${parseFloat(supplierDetails.total_verified_cost || 0).toFixed(2)}`,
  ]);

  const costVariance =
    parseFloat(supplierDetails.total_ordered_cost || 0) -
    parseFloat(supplierDetails.total_verified_cost || 0);
  overviewSheet.addRow([
    "Cost Variance (Ordered - Verified)",
    `$${costVariance.toFixed(2)}`,
  ]);

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
    "Processing Days",
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

  purchaseOrders.forEach((po) => {
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
      po.order_date ? new Date(po.order_date).toLocaleDateString() : "N/A",
      po.verification_date
        ? new Date(po.verification_date).toLocaleDateString()
        : "Pending",
      po.status,
      po.purchase_type || "N/A",
      po.payment_status || "N/A",
      parseInt(po.products_count || 0),
      parseInt(po.total_ordered_qty || 0),
      parseInt(po.total_verified_qty || 0),
      po.verification_rate
        ? `${parseFloat(po.verification_rate).toFixed(1)}%`
        : "N/A",
      parseFloat(po.ordered_value || 0).toFixed(2),
      parseFloat(po.verified_value || 0).toFixed(2),
      parseFloat(po.total_amount || 0).toFixed(2),
      parseFloat(po.paid_amount || 0).toFixed(2),
      po.processing_days !== null
        ? parseFloat(po.processing_days).toFixed(1)
        : "N/A",
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
    totalOrderedQty > 0
      ? `${((totalVerifiedQty / totalOrderedQty) * 100).toFixed(1)}%`
      : "N/A",
    totalOrderedValue.toFixed(2),
    totalVerifiedValue.toFixed(2),
    totalAmount.toFixed(2),
    totalPaid.toFixed(2),
    ordersWithDates > 0
      ? (totalProcessingDays / ordersWithDates).toFixed(1)
      : "N/A",
  ]);
  summaryRow.font = { bold: true };

  // Sheet 3: Products Performance & Profitability
  const productsSheet = workbook.addWorksheet("Products from Supplier");

  addReportHeader(
    productsSheet,
    "Products Sourced from This Supplier - Performance Analysis",
    15,
  );

  // Add important note section
  let currentRow = 5;
  productsSheet.mergeCells(`A${currentRow}:O${currentRow}`);
  productsSheet.getCell(`A${currentRow}`).value =
    "⚠️ IMPORTANT: All quantities and prices shown below are specific to THIS SUPPLIER ONLY";
  productsSheet.getCell(`A${currentRow}`).font = {
    bold: true,
    size: 12,
    color: { argb: "FFFF0000" },
  };
  productsSheet.getCell(`A${currentRow}`).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFF4CC" },
  };
  productsSheet.getCell(`A${currentRow}`).alignment = {
    vertical: "middle",
    horizontal: "center",
  };
  productsSheet.getRow(currentRow).height = 25;
  currentRow++;

  // Add spacing
  currentRow++;

  // Add column headers
  const productTitles = [
    "Product Name",
    "SKU",
    "Category",
    "Status",
    "Qty Purchased\n(This Supplier)",
    "Purchase\nOrders Count",
    "First Purchase\nDate",
    "Last Purchase\nDate",
    "Avg Purchase Price\n(This Supplier)",
    "Lowest\nPrice Paid",
    "Highest\nPrice Paid",
    "Current Avg\nSelling Price",
    "Potential\nProfit/Unit",
    "Markup\n%",
    "Est. Potential\nProfit",
  ];

  productsSheet.getRow(currentRow).values = productTitles;
  productsSheet.getRow(currentRow).font = {
    bold: true,
    color: { argb: "FFFFFFFF" },
  };
  productsSheet.getRow(currentRow).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4472C4" },
  };
  productsSheet.getRow(currentRow).alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true,
  };
  productsSheet.getRow(currentRow).height = 40;

  // Add borders to header
  for (let col = 1; col <= 15; col++) {
    productsSheet.getCell(currentRow, col).border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  }

  const headerRow = currentRow;
  currentRow++;

  let totalPurchasedQty = 0;
  let totalPotentialProfit = 0;
  const dataStartRow = currentRow;

  products.forEach((p, index) => {
    totalPurchasedQty += parseInt(p.qty_purchased_from_supplier || 0);
    totalPotentialProfit += parseFloat(p.estimated_potential_profit || 0);

    const row = productsSheet.getRow(currentRow);
    row.values = [
      p.product_name,
      p.sku,
      p.category_name || "N/A",
      p.status,
      parseInt(p.qty_purchased_from_supplier || 0),
      parseInt(p.purchase_order_count || 0),
      p.first_purchase_date
        ? new Date(p.first_purchase_date).toLocaleDateString()
        : "N/A",
      p.last_purchase_date
        ? new Date(p.last_purchase_date).toLocaleDateString()
        : "N/A",
      parseFloat(p.avg_purchase_price_from_supplier || 0).toFixed(2),
      parseFloat(p.lowest_purchase_price || 0).toFixed(2),
      parseFloat(p.highest_purchase_price || 0).toFixed(2),
      parseFloat(p.current_avg_selling_price || 0).toFixed(2),
      parseFloat(p.potential_profit_per_unit || 0).toFixed(2),
      p.markup_percentage
        ? `${parseFloat(p.markup_percentage).toFixed(1)}%`
        : "N/A",
      parseFloat(p.estimated_potential_profit || 0).toFixed(2),
    ];

    // Alternating row colors
    if (index % 2 === 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF2F2F2" },
      };
    }

    // Add borders
    for (let col = 1; col <= 15; col++) {
      productsSheet.getCell(currentRow, col).border = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };
    }

    // Align numbers to right
    for (let col = 5; col <= 15; col++) {
      productsSheet.getCell(currentRow, col).alignment = {
        horizontal: "right",
      };
    }

    currentRow++;
  });

  // Add summary row
  currentRow++;
  const productSummaryRow = productsSheet.getRow(currentRow);
  productSummaryRow.values = [
    "TOTAL",
    `${products.length} Products`,
    "",
    "",
    totalPurchasedQty,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    totalPotentialProfit.toFixed(2),
  ];
  productSummaryRow.font = { bold: true, size: 11 };
  productSummaryRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFD966" },
  };

  // Add borders to summary
  for (let col = 1; col <= 15; col++) {
    productsSheet.getCell(currentRow, col).border = {
      top: { style: "double" },
      bottom: { style: "double" },
    };
    productsSheet.getCell(currentRow, col).alignment = {
      horizontal: col >= 5 ? "right" : "left",
    };
  }

  // Set column widths
  productsSheet.getColumn(1).width = 30; // Product Name
  productsSheet.getColumn(2).width = 15; // SKU
  productsSheet.getColumn(3).width = 20; // Category
  productsSheet.getColumn(4).width = 12; // Status
  productsSheet.getColumn(5).width = 15; // Qty Purchased
  productsSheet.getColumn(6).width = 15; // PO Count
  productsSheet.getColumn(7).width = 15; // First Purchase
  productsSheet.getColumn(8).width = 15; // Last Purchase
  productsSheet.getColumn(9).width = 18; // Avg Purchase Price
  productsSheet.getColumn(10).width = 15; // Lowest Price
  productsSheet.getColumn(11).width = 15; // Highest Price
  productsSheet.getColumn(12).width = 18; // Current Selling Price
  productsSheet.getColumn(13).width = 15; // Profit/Unit
  productsSheet.getColumn(14).width = 12; // Markup %
  productsSheet.getColumn(15).width = 18; // Est. Potential Profit

  // Add field explanations section after data
  currentRow += 3;
  productsSheet.mergeCells(`A${currentRow}:O${currentRow}`);
  productsSheet.getCell(`A${currentRow}`).value = "FIELD EXPLANATIONS:";
  productsSheet.getCell(`A${currentRow}`).font = { bold: true, size: 12 };
  productsSheet.getCell(`A${currentRow}`).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9E1F2" },
  };
  productsSheet.getCell(`A${currentRow}`).alignment = { horizontal: "center" };
  currentRow++;

  const explanations = [
    ["Product Name", "Name of the product"],
    ["SKU", "Stock Keeping Unit - Unique product identifier"],
    ["Category", "Product category classification"],
    ["Status", "Current product status (Active/Inactive)"],
    [
      "Qty Purchased (This Supplier)",
      "Total quantity purchased from THIS supplier across all purchase orders",
    ],
    [
      "Purchase Orders Count",
      "Number of purchase orders placed with this supplier for this product",
    ],
    ["First Purchase Date", "Date of the first purchase from this supplier"],
    [
      "Last Purchase Date",
      "Date of the most recent purchase from this supplier",
    ],
    [
      "Avg Purchase Price (This Supplier)",
      "Average price paid to THIS supplier per unit (weighted average across all purchases)",
    ],
    [
      "Lowest Price Paid",
      "Lowest unit price ever paid to this supplier for this product",
    ],
    [
      "Highest Price Paid",
      "Highest unit price ever paid to this supplier for this product",
    ],
    [
      "Current Avg Selling Price",
      "Current average selling price in the market (from ALL inventory sources, not just this supplier)",
    ],
    [
      "Potential Profit/Unit",
      "Estimated profit per unit (Current Selling Price - Avg Purchase Price from this supplier)",
    ],
    [
      "Markup %",
      "Percentage markup over purchase price: [(Selling Price - Purchase Price) / Purchase Price × 100]",
    ],
    [
      "Est. Potential Profit",
      "Estimated total profit if all units from this supplier are sold at current selling price",
    ],
  ];

  explanations.forEach(([field, explanation]) => {
    productsSheet.getCell(`A${currentRow}`).value = field;
    productsSheet.getCell(`A${currentRow}`).font = { bold: true, size: 9 };
    productsSheet.getCell(`B${currentRow}`).value = explanation;
    productsSheet.getCell(`B${currentRow}`).font = { size: 9, italic: true };
    productsSheet.mergeCells(`B${currentRow}:O${currentRow}`);
    currentRow++;
  });

  // Auto-fit columns
  [overviewSheet, ordersSheet, productsSheet].forEach((sheet) => {
    sheet.columns.forEach((column) => {
      if (!column.width) {
        column.width = 15;
      }
    });
  });

  return await workbook.xlsx.writeBuffer();
};

module.exports = generate_supplier_performance_report;
