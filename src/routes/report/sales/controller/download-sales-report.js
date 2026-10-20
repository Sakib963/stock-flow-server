const { send_report_workbook } = require("../../utils/report-response");
const { SALES_REPORTS } = require("../utils/reports");

const download_sales_report = (request, res) => send_report_workbook(SALES_REPORTS, request, res);

module.exports = download_sales_report;
