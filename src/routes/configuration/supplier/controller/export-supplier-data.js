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
      log.warn("Supplier OID is required");
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

    const buffer = await generate_export_xlsx(
      supplierDetails,
      products,
      purchaseHistory,
    );
    const timestamp = Date.now();
    const file_name = `${supplierDetails.name.replace(/\s+/g, "_")}_export_${timestamp}.xlsx`;
    const file_name_ascii = file_name.replace(/[^\x00-\x7F]/g, "");
    const file_name_encoded = encodeURIComponent(file_name);

    log.info(
      `Export supplier data for [${supplierDetails.name}] - [${file_name}]`,
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
      `An exception occurred while exporting supplier data: ${e?.message}`,
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
                  -- Supplier-Specific Purchase Data
                  SUM(COALESCE(pd.verified_quantity, pd.ordered_quantity)) as qty_purchased_from_supplier,
                  COUNT(DISTINCT pu.oid) as purchase_order_count,
                  MIN(pu.created_on) as first_purchase_date,
                  MAX(pu.created_on) as last_purchase_date,
                  ROUND(COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price))::numeric, 2) as avg_purchase_price_from_supplier,
                  ROUND(COALESCE(MIN(pd.verified_unit_price), MIN(pd.ordered_unit_price))::numeric, 2) as min_purchase_price,
                  ROUND(COALESCE(MAX(pd.verified_unit_price), MAX(pd.ordered_unit_price))::numeric, 2) as max_purchase_price,
                  -- Current Market Data (All Sources)
                  ROUND(COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0), 2) AS current_avg_selling_price,
                  ROUND(COALESCE(MIN(CAST(i.selling_price AS NUMERIC)), 0), 2) AS current_min_selling_price,
                  ROUND(COALESCE(MAX(CAST(i.selling_price AS NUMERIC)), 0), 2) AS current_max_selling_price,
                  ROUND(COALESCE(SUM(CAST(i.quantity_available AS INTEGER) * CAST(COALESCE(i.selling_price, 0) AS NUMERIC)), 0), 2) AS total_inventory_value_all_sources,
                  -- Potential Profit
                  ROUND(COALESCE(AVG(CAST(i.selling_price AS NUMERIC)), 0) - COALESCE(AVG(pd.verified_unit_price), AVG(pd.ordered_unit_price)), 2) as potential_profit_per_unit,
                  p.created_on,
                  p.created_by
            FROM ${TABLE.PRODUCT} p
            INNER JOIN ${TABLE.PURCHASE_DETAILS} pd ON pd.product_oid = p.oid
            INNER JOIN ${TABLE.PURCHASE} pu ON pu.oid = pd.purchase_oid AND pu.supplier_oid = $1
            LEFT JOIN ${TABLE.CATEGORIES} c ON c.oid = p.category_oid
            LEFT JOIN ${TABLE.SUB_CATEGORIES} sc ON sc.oid = p.sub_category_oid
            LEFT JOIN ${TABLE.BRANDS} b ON b.oid = p.brand_oid
            LEFT JOIN ${TABLE.INVENTORY} i ON i.product_oid = p.oid AND i.status IN ('ready_for_sale', 'pending_pricing')
            WHERE p.is_deleted = FALSE
            GROUP BY p.oid, p.name, p.sku, p.description, p.status, p.unit_type, p.restock_threshold,
                     c.name, sc.name, b.name, p.created_on, p.created_by
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

const generate_export_xlsx = async (
  supplierDetails,
  products,
  purchaseHistory,
) => {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Supplier Information
  const infoSheet = workbook.addWorksheet("Supplier Information");
  addReportHeader(
    infoSheet,
    `Supplier Data Export - ${supplierDetails.name}`,
    2,
  );

  infoSheet.getColumn(1).width = 25;
  infoSheet.getColumn(2).width = 50;

  const infoStartRow = 5;
  infoSheet.getRow(infoStartRow).values = ["Field", "Value"];
  infoSheet.getRow(infoStartRow).font = { bold: true };

  infoSheet.addRow(["Supplier Name", supplierDetails.name]);
  infoSheet.addRow(["Contact Person", supplierDetails.contact_person || "N/A"]);
  infoSheet.addRow(["Phone", supplierDetails.phone_number || "N/A"]);
  infoSheet.addRow(["Email", supplierDetails.email || "N/A"]);
  infoSheet.addRow(["Address", supplierDetails.address || "N/A"]);
  infoSheet.addRow(["Status", supplierDetails.status]);
  infoSheet.addRow([
    "Total Products",
    parseInt(supplierDetails.total_products || 0),
  ]);
  infoSheet.addRow([
    "Total Purchase Orders",
    parseInt(supplierDetails.total_orders || 0),
  ]);
  infoSheet.addRow(["Created By", supplierDetails.created_by]);
  infoSheet.addRow([
    "Created On",
    supplierDetails.created_on
      ? new Date(supplierDetails.created_on).toLocaleString()
      : "N/A",
  ]);
  infoSheet.addRow(["Last Edited By", supplierDetails.edited_by || "N/A"]);
  infoSheet.addRow([
    "Last Edited On",
    supplierDetails.edited_on
      ? new Date(supplierDetails.edited_on).toLocaleString()
      : "N/A",
  ]);

  // Sheet 2: Products
  const productsSheet = workbook.addWorksheet("Products from Supplier");

  addReportHeader(productsSheet, "Products Sourced from This Supplier", 22);

  // Add important note section
  let currentRow = 5;
  productsSheet.mergeCells(`A${currentRow}:V${currentRow}`);
  productsSheet.getCell(`A${currentRow}`).value =
    "⚠️ IMPORTANT: Purchase quantities and prices are specific to THIS SUPPLIER ONLY. Inventory and selling prices reflect current market data from ALL sources.";
  productsSheet.getCell(`A${currentRow}`).font = {
    bold: true,
    size: 11,
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
    wrapText: true,
  };
  productsSheet.getRow(currentRow).height = 35;
  currentRow++;

  // Add spacing
  currentRow++;

  // Add column headers
  const productTitles = [
    "Product Name",
    "SKU",
    "Category",
    "Sub Category",
    "Brand",
    "Status",
    "Unit Type",
    "Restock\nThreshold",
    "Qty Purchased\n(This Supplier)",
    "Purchase\nOrders Count",
    "First Purchase\nDate",
    "Last Purchase\nDate",
    "Avg Purchase Price\n(This Supplier)",
    "Min Purchase\nPrice",
    "Max Purchase\nPrice",
    "Current Avg\nSelling Price",
    "Current Min\nSelling Price",
    "Current Max\nSelling Price",
    "Potential\nProfit/Unit",
    "Total Inventory Value\n(All Sources)",
    "Created By",
    "Created On",
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
  for (let col = 1; col <= 22; col++) {
    productsSheet.getCell(currentRow, col).border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  }

  const headerRow = currentRow;
  currentRow++;

  let totalInventoryValue = 0;
  let totalPurchasedQty = 0;
  const dataStartRow = currentRow;

  products.forEach((p, index) => {
    totalInventoryValue += parseFloat(p.total_inventory_value_all_sources || 0);
    totalPurchasedQty += parseInt(p.qty_purchased_from_supplier || 0);

    const row = productsSheet.getRow(currentRow);
    row.values = [
      p.product_name,
      p.sku,
      p.category_name || "N/A",
      p.sub_category_name || "N/A",
      p.brand_name || "N/A",
      p.status,
      p.unit_type || "N/A",
      parseInt(p.restock_threshold || 0),
      parseInt(p.qty_purchased_from_supplier || 0),
      parseInt(p.purchase_order_count || 0),
      p.first_purchase_date
        ? new Date(p.first_purchase_date).toLocaleDateString()
        : "N/A",
      p.last_purchase_date
        ? new Date(p.last_purchase_date).toLocaleDateString()
        : "N/A",
      parseFloat(p.avg_purchase_price_from_supplier || 0).toFixed(2),
      parseFloat(p.min_purchase_price || 0).toFixed(2),
      parseFloat(p.max_purchase_price || 0).toFixed(2),
      parseFloat(p.current_avg_selling_price || 0).toFixed(2),
      parseFloat(p.current_min_selling_price || 0).toFixed(2),
      parseFloat(p.current_max_selling_price || 0).toFixed(2),
      parseFloat(p.potential_profit_per_unit || 0).toFixed(2),
      parseFloat(p.total_inventory_value_all_sources || 0).toFixed(2),
      p.created_by,
      p.created_on ? new Date(p.created_on).toLocaleDateString() : "N/A",
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
    for (let col = 1; col <= 22; col++) {
      productsSheet.getCell(currentRow, col).border = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };
    }

    // Align numbers to right
    for (let col = 8; col <= 20; col++) {
      productsSheet.getCell(currentRow, col).alignment = {
        horizontal: "right",
      };
    }

    currentRow++;
  });

  // Add summary row
  currentRow++;
  const summaryRow = productsSheet.getRow(currentRow);
  summaryRow.values = [
    "TOTAL",
    `${products.length} Products`,
    "",
    "",
    "",
    "",
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
    "",
    totalInventoryValue.toFixed(2),
    "",
    "",
  ];
  summaryRow.font = { bold: true, size: 11 };
  summaryRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFD966" },
  };

  // Add borders to summary
  for (let col = 1; col <= 22; col++) {
    productsSheet.getCell(currentRow, col).border = {
      top: { style: "double" },
      bottom: { style: "double" },
    };
    productsSheet.getCell(currentRow, col).alignment = {
      horizontal: col >= 8 ? "right" : "left",
    };
  }

  // Set column widths
  productsSheet.getColumn(1).width = 30; // Product Name
  productsSheet.getColumn(2).width = 15; // SKU
  productsSheet.getColumn(3).width = 20; // Category
  productsSheet.getColumn(4).width = 20; // Sub Category
  productsSheet.getColumn(5).width = 20; // Brand
  productsSheet.getColumn(6).width = 12; // Status
  productsSheet.getColumn(7).width = 12; // Unit Type
  productsSheet.getColumn(8).width = 12; // Restock Threshold
  productsSheet.getColumn(9).width = 15; // Qty Purchased
  productsSheet.getColumn(10).width = 15; // PO Count
  productsSheet.getColumn(11).width = 15; // First Purchase
  productsSheet.getColumn(12).width = 15; // Last Purchase
  productsSheet.getColumn(13).width = 18; // Avg Purchase Price
  productsSheet.getColumn(14).width = 15; // Min Purchase Price
  productsSheet.getColumn(15).width = 15; // Max Purchase Price
  productsSheet.getColumn(16).width = 18; // Current Avg Selling
  productsSheet.getColumn(17).width = 18; // Current Min Selling
  productsSheet.getColumn(18).width = 18; // Current Max Selling
  productsSheet.getColumn(19).width = 15; // Profit/Unit
  productsSheet.getColumn(20).width = 20; // Inventory Value
  productsSheet.getColumn(21).width = 15; // Created By
  productsSheet.getColumn(22).width = 15; // Created On

  // Add field explanations section after data
  currentRow += 3;
  productsSheet.mergeCells(`A${currentRow}:V${currentRow}`);
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
    ["Sub Category", "Product sub-category classification"],
    ["Brand", "Product brand name"],
    ["Status", "Current product status (Active/Inactive/Discontinued)"],
    ["Unit Type", "Unit of measurement (pieces, kg, liters, etc.)"],
    ["Restock Threshold", "Minimum stock level before reorder alert"],
    [
      "Qty Purchased (This Supplier)",
      "Total quantity purchased from THIS supplier only across all purchase orders",
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
      "Average price paid to THIS supplier per unit (weighted average)",
    ],
    ["Min Purchase Price", "Lowest unit price ever paid to this supplier"],
    ["Max Purchase Price", "Highest unit price ever paid to this supplier"],
    [
      "Current Avg Selling Price",
      "Current average selling price in market (from ALL inventory sources)",
    ],
    [
      "Current Min Selling Price",
      "Current minimum selling price in market (from ALL inventory sources)",
    ],
    [
      "Current Max Selling Price",
      "Current maximum selling price in market (from ALL inventory sources)",
    ],
    [
      "Potential Profit/Unit",
      "Estimated profit per unit (Current Selling Price - Avg Purchase Price from this supplier)",
    ],
    [
      "Total Inventory Value (All Sources)",
      "Total value of current inventory from ALL suppliers (not just this one)",
    ],
    ["Created By", "User who created this product record"],
    ["Created On", "Date when this product was created in the system"],
  ];

  explanations.forEach(([field, explanation]) => {
    productsSheet.getCell(`A${currentRow}`).value = field;
    productsSheet.getCell(`A${currentRow}`).font = { bold: true, size: 9 };
    productsSheet.getCell(`B${currentRow}`).value = explanation;
    productsSheet.getCell(`B${currentRow}`).font = { size: 9, italic: true };
    productsSheet.mergeCells(`B${currentRow}:V${currentRow}`);
    currentRow++;
  });

  // Add borders to summary
  for (let col = 1; col <= 23; col++) {
    productsSheet.getCell(currentRow, col).border = {
      top: { style: "double" },
      bottom: { style: "double" },
    };
    productsSheet.getCell(currentRow, col).alignment = {
      horizontal: col >= 9 ? "right" : "left",
    };
  }

  // Set column widths
  productsSheet.getColumn(1).width = 30; // Product Name
  productsSheet.getColumn(2).width = 15; // SKU
  productsSheet.getColumn(3).width = 35; // Description
  productsSheet.getColumn(4).width = 20; // Category
  productsSheet.getColumn(5).width = 20; // Sub Category
  productsSheet.getColumn(6).width = 20; // Brand
  productsSheet.getColumn(7).width = 12; // Status
  productsSheet.getColumn(8).width = 12; // Unit Type
  productsSheet.getColumn(9).width = 12; // Restock Threshold
  productsSheet.getColumn(10).width = 15; // Qty Purchased
  productsSheet.getColumn(11).width = 15; // PO Count
  productsSheet.getColumn(12).width = 15; // First Purchase
  productsSheet.getColumn(13).width = 15; // Last Purchase
  productsSheet.getColumn(14).width = 18; // Avg Purchase Price
  productsSheet.getColumn(15).width = 15; // Min Purchase Price
  productsSheet.getColumn(16).width = 15; // Max Purchase Price
  productsSheet.getColumn(17).width = 18; // Current Avg Selling
  productsSheet.getColumn(18).width = 18; // Current Min Selling
  productsSheet.getColumn(19).width = 18; // Current Max Selling
  productsSheet.getColumn(20).width = 15; // Profit/Unit
  productsSheet.getColumn(21).width = 20; // Inventory Value
  productsSheet.getColumn(22).width = 15; // Created By
  productsSheet.getColumn(23).width = 15; // Created On

  // Sheet 3: Purchase History
  const historySheet = workbook.addWorksheet("Purchase History");
  const historyTitles = [
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
    "Created On",
  ];

  addReportHeader(historySheet, "Purchase Order History", historyTitles.length);
  historySheet.addRow(historyTitles);
  historySheet.getRow(5).font = { bold: true };

  let totalPurchaseAmount = 0;

  purchaseHistory.forEach((po) => {
    totalPurchaseAmount += parseFloat(po.total_amount || 0);

    historySheet.addRow([
      po.order_date ? new Date(po.order_date).toLocaleDateString() : "N/A",
      po.status,
      po.purchase_type || "N/A",
      po.payment_status || "N/A",
      parseFloat(po.total_amount || 0).toFixed(2),
      parseInt(po.products_count || 0),
      parseInt(po.total_quantity || 0),
      po.product_names || "N/A",
      po.notes || "",
      po.created_by,
      po.created_on ? new Date(po.created_on).toLocaleDateString() : "N/A",
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
    "",
  ]);
  historySummaryRow.font = { bold: true };

  // Auto-fit columns
  [infoSheet, productsSheet, historySheet].forEach((sheet) => {
    sheet.columns.forEach((column) => {
      if (!column.width) {
        column.width = 15;
      }
    });
  });

  return await workbook.xlsx.writeBuffer();
};

module.exports = export_supplier_data;
