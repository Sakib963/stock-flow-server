const { send_report_workbook } = require("../../utils/report-response");
const { STOCK_REPORTS } = require("../utils/reports");

const download_stock_report = (request, res) => send_report_workbook(STOCK_REPORTS, request, res);

module.exports = download_stock_report;
