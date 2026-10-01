const ExcelJS = require("exceljs");
const { TABLE } = require("../../../../utils/constant");
const { get_data } = require("../../../../db/database");
const { log } = require("../../../../utils/log");
const { addReportHeader } = require("../../../../utils/report-header");
const { sees_money } = require("../../utils/sees-money");
const { send_workbook, fit_columns } = require("../../utils/report");
const { LINES_SQL } = require("../utils/dispose-sql");
const { REASON_LABEL, METHOD_LABEL } = require("../utils/dispose-rules");
const { business_zone, format_business, zone_label } = require("../../../../utils/business-time");

const HEADER_SQL = `SELECT dispose_no, disposal_method, status, notes, reject_reason, cancel_reason, created_on, created_by, approved_on, approved_by FROM ${TABLE.PRODUCT_DISPOSE} WHERE oid = $1`;

// One disposal and its lines. Cost and value are written only for someone who may see money, as on the page.
const generate_product_dispose_report = async (request, res) => {
      const oid = request.params.oid;
      try {
            const [[disposal], lines, money, zone] = await Promise.all([get_data({ text: HEADER_SQL, values: [oid] }), get_data({ text: LINES_SQL, values: [oid] }), sees_money(request), business_zone()]);
            if (!disposal) return res.status(404).json({ code: 404, message: "That disposal no longer exists." });

            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("Disposal");
            const titles = ["Product", "SKU", "Batch", "Quantity", "Reason", "Line note", "Warehouse", "Expiry date", ...(money ? ["Cost price", "Value"] : [])];
            addReportHeader(sheet, `Disposal ${disposal.dispose_no}`, titles.length);
            sheet.addRow(titles).font = { bold: true };
            for (const line of lines) {
                  sheet.addRow([line.product_name, line.sku ?? "", line.batch_code ?? "", line.quantity ?? "", REASON_LABEL[line.reason] ?? "", line.line_note ?? "", line.warehouse_name ?? "", line.expiry_date ?? "", ...(money ? [line.cost_price === null ? "" : Number(line.cost_price), line.value === null ? "" : Number(line.value)] : [])]);
            }
            sheet.addRow([]);
            const summary = [
                  ["Number", disposal.dispose_no],
                  ["Method", METHOD_LABEL[disposal.disposal_method] ?? ""],
                  ["Status", disposal.status],
                  ["Note", disposal.notes ?? ""],
                  ["Created", `${format_business(disposal.created_on, zone)} by ${disposal.created_by}`],
            ];
            if (disposal.approved_on) summary.push(["Approved", `${format_business(disposal.approved_on, zone)} by ${disposal.approved_by}`]);
            if (disposal.reject_reason) summary.push(["Rejected because", disposal.reject_reason]);
            if (disposal.cancel_reason) summary.push(["Cancelled because", disposal.cancel_reason]);
            summary.push(["Times", zone_label(zone)]);
            for (const [label, value] of summary) sheet.addRow([label, value]).getCell(1).font = { bold: true };
            fit_columns(sheet);

            return send_workbook(res, workbook, `${disposal.dispose_no}.xlsx`);
      } catch (e) {
            log.error(`An exception occurred while building the report of disposal ${oid}: ${e?.message}`);
            return res.status(500).json({ code: 500, message: "Could not build the report. Try again in a moment." });
      }
};

module.exports = generate_product_dispose_report;
