const ExcelJS = require("exceljs");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { addReportHeader } = require("../../../../utils/report-header");
const { sees_money } = require("../utils/stock-figures");
const { PRODUCT_SQL, FIGURES_SQL, BATCHES_SQL } = require("../utils/product-stock-sql");

const QUANTITY_COLUMNS = ["Batch code", "Status", "Received on", "Purchase order", "Supplier", "Warehouse", "Aisle", "Received", "On hand", "Held", "Sellable", "Expiry date", "Selling price", "Max discount"];
const MONEY_COLUMNS = ["Cost price", "Budget per unit", "Stock value", "Probable revenue", "Probable profit"];

// created_on has no zone and pg reads it as local time, so the local parts are the day as stored,
// the day the page shows. toISOString would move a batch received after midnight to the day before.
const stored_day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const readable = (status) => (status ? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ") : "");

// A product's stock as it stands: every batch still holding stock, then the product's totals. Cost,
// value and profit are written only for someone who may see them, as on the page.
const generate_product_stock_report = async (request, res) => {
      const oid = request.params.oid;
      try {
            const [[product], [figures], batches, money] = await Promise.all([get_data({ text: PRODUCT_SQL, values: [oid] }), get_data({ text: FIGURES_SQL, values: [oid] }), get_data({ text: BATCHES_SQL, values: [oid] }), sees_money(request)]);
            if (!product) return res.status(404).json({ code: 404, message: "That product no longer exists. It may have been deleted." });

            const buffer = await build_workbook(product, figures, batches.filter((b) => b.on_hand > 0 || b.held > 0), money);
            const file_name = `${product.sku || product.name.replace(/\s+/g, "_")}_stock_report_${stored_day(new Date())}.xlsx`;
            const file_name_encoded = encodeURIComponent(file_name);

            res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                  .set("Content-Disposition", `attachment; filename="${file_name.replace(/[^\x00-\x7F]/g, "")}"; filename*=UTF-8''${file_name_encoded}`)
                  .set("X-Filename", file_name_encoded)
                  .set("Access-Control-Expose-Headers", "X-Filename")
                  .set("Content-Length", buffer.length)
                  .send(buffer);
      } catch (e) {
            log.error(`An exception occurred while building the stock report of product ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not build the stock report. Try again in a moment." });
      }
};

const build_workbook = async (product, figures, batches, money) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Stock");
      const titles = money ? [...QUANTITY_COLUMNS, ...MONEY_COLUMNS] : QUANTITY_COLUMNS;

      addReportHeader(sheet, `Stock report - ${product.name}`, titles.length);
      sheet.addRow(titles).font = { bold: true };

      for (const b of batches) {
            const row = [b.batch_code, readable(b.status), stored_day(b.received_on), b.po_number ?? "", b.supplier_name ?? "", b.warehouse_name ?? "", b.aisle_name ?? "", b.initial_quantity, b.on_hand, b.held, b.sellable, b.expiry_date ?? "", b.selling_price === null ? "" : Number(b.selling_price), b.maximum_discount === null ? "" : Number(b.maximum_discount)];
            if (money) row.push(Number(b.cost_price), Number(b.budget_per_unit), b.stock_value, b.expected_revenue ?? "", b.profit_full ?? "");
            sheet.addRow(row);
      }

      sheet.addRow([]);
      const summary = [
            ["Product", product.name],
            ["SKU", product.sku ?? ""],
            ["Category", [product.category_name, product.sub_category_name].filter(Boolean).join(" > ")],
            ["Brand", product.brand_name ?? ""],
            ["On hand", figures.on_hand ?? 0],
            ["Held for orders", figures.held ?? 0],
            ["Sellable", figures.sellable ?? 0],
            ["Restock level", product.restock_threshold],
      ];
      if (money) {
            summary.push(["Stock value at cost", figures.stock_value], ["Probable revenue", figures.expected_revenue], ["Probable profit at full price", figures.profit_full], ["Probable profit at full discount", figures.profit_discounted]);
      }
      summary.push(["Generated on", new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"]);
      for (const [label, value] of summary) sheet.addRow([label, value]).getCell(1).font = { bold: true };

      sheet.columns.forEach((column) => {
            let widest = 0;
            column.eachCell({ includeEmpty: false }, (cell) => (widest = Math.max(widest, cell.value?.toString().length ?? 0)));
            column.width = Math.min(Math.max(widest + 1, 10), 30);
      });

      return workbook.xlsx.writeBuffer();
};

module.exports = generate_product_stock_report;
