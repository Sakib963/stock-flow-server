const ExcelJS = require("exceljs");
const { getSettings } = require("../../../utils/settings-cache");
const { business_zone, format_business, zone_label } = require("../../../utils/business-time");
const { send_workbook, fit_columns } = require("../../inventory/utils/report");
const { label } = require("./labels");

const FORMAT = { money: "#,##0", int: "#,##0", percent: "0.0%" };

const cell = (type, value) => {
    if (value === null || value === undefined || value === "") return "";
    if (type === "money" || type === "int") return Number(value);
    // Margins travel as percentages (32.5); Excel's percent format wants the fraction.
    if (type === "percent") return Number(value) / 100;
    return label(type, value);
};

/**
 * One sheet: the business, the report and its period, when and by whom it was made, the totals, the
 * rows as numbers Excel can sum, and the clock its days are on (REQ-18, REQ-20). The business name
 * comes from its settings: the old report header printed a made-up company.
 */
const write_workbook = async (res, report, { filters, file_name, request }) => {
    const [settings, zone] = await Promise.all([getSettings(), business_zone()]);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(report.title.slice(0, 31));

    sheet.addRow([settings?.name || "Business"]).font = { bold: true, size: 14 };
    sheet.addRow([report.title]).font = { bold: true, size: 12 };
    if (report.period) sheet.addRow([`${report.period.date_from} to ${report.period.date_to}`]);
    for (const [label, value] of filters) sheet.addRow([`${label}: ${value}`]);
    sheet.addRow([`Made ${format_business(new Date(), zone)} by ${request.credentials.user_id}. ${zone_label(zone)}`]).font = { color: { argb: "FF666666" } };
    sheet.addRow([]);

    const header = sheet.addRow(report.columns.map((c) => c.label));
    header.font = { bold: true };
    for (const row of report.rows) sheet.addRow(report.columns.map((c) => cell(c.type, row[c.key])));
    const totals = sheet.addRow(report.columns.map((c, i) => (i === 0 ? "Total" : c.key in report.totals ? cell(c.type, report.totals[c.key]) : "")));
    totals.font = { bold: true };
    if (report.note) sheet.addRow([report.note]).font = { italic: true, color: { argb: "FF666666" } };

    report.columns.forEach((c, i) => {
        if (FORMAT[c.type]) sheet.getColumn(i + 1).numFmt = FORMAT[c.type];
    });
    fit_columns(sheet);
    sheet.views = [{ state: "frozen", ySplit: header.number }];

    return send_workbook(res, workbook, file_name);
};

module.exports = { write_workbook };
