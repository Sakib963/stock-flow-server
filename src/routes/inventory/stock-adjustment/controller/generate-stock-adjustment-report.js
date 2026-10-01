const ExcelJS = require("exceljs");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { addReportHeader } = require("../../../../utils/report-header");
const { sees_money } = require("../../utils/sees-money");
const { LINES_SQL } = require("../utils/adjustment-sql");
const { REASON_LABEL } = require("../utils/adjustment-rules");
const { send_workbook, fit_columns } = require("../../utils/report");
const { business_zone, format_business, zone_label } = require("../../../../utils/business-time");

const HEADER_SQL = `SELECT oid, adjustment_number, reason, status, note, reject_reason, cancel_reason, created_on, created_by, verified_on, verified_by FROM ${TABLE.STOCK_ADJUSTMENT} WHERE oid = $1`;

// One adjustment and its lines. The cost and value columns are written only for someone who may see
// money, as on the page.
const generate_stock_adjustment_report = async (request, res) => {
      const oid = request.params.oid;
      try {
            const [[adjustment], lines, money, zone] = await Promise.all([get_data({ text: HEADER_SQL, values: [oid] }), get_data({ text: LINES_SQL, values: [oid] }), sees_money(request), business_zone()]);
            if (!adjustment) return res.status(404).json({ code: 404, message: "That adjustment no longer exists." });

            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("Adjustment");
            const titles = ["Product", "SKU", "Batch", "Direction", "Quantity", "Warehouse", "Aisle", "Expiry date", ...(money ? ["Cost price", "Value"] : [])];
            addReportHeader(sheet, `Stock adjustment ${adjustment.adjustment_number}`, titles.length);
            sheet.addRow(titles).font = { bold: true };
            for (const line of lines) {
                  sheet.addRow([line.product_name, line.sku ?? "", line.batch_code ?? "New batch", line.direction === "out" ? "Out" : "In", line.quantity ?? "", line.warehouse_name ?? "", line.aisle_name ?? "", line.expiry_date ?? "", ...(money ? [line.cost_price === null ? "" : Number(line.cost_price), line.value === null ? "" : Number(line.value)] : [])]);
            }
            sheet.addRow([]);
            const summary = [
                  ["Number", adjustment.adjustment_number],
                  ["Reason", REASON_LABEL[adjustment.reason]],
                  ["Status", adjustment.status],
                  ["Note", adjustment.note ?? ""],
                  ["Created", `${format_business(adjustment.created_on, zone)} by ${adjustment.created_by}`],
            ];
            if (adjustment.verified_on) summary.push(["Verified", `${format_business(adjustment.verified_on, zone)} by ${adjustment.verified_by}`]);
            if (adjustment.reject_reason) summary.push(["Rejected because", adjustment.reject_reason]);
            if (adjustment.cancel_reason) summary.push(["Cancelled because", adjustment.cancel_reason]);
            summary.push(["Times", zone_label(zone)]);
            for (const [label, value] of summary) sheet.addRow([label, value]).getCell(1).font = { bold: true };
            fit_columns(sheet);

            return send_workbook(res, workbook, `${adjustment.adjustment_number}.xlsx`);
      } catch (e) {
            log.error(`An exception occurred while building the report of stock adjustment ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not build the report. Try again in a moment." });
      }
};

module.exports = generate_stock_adjustment_report;
