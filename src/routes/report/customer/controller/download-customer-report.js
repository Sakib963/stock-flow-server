const { send_report_workbook } = require("../../utils/report-response");
const { CUSTOMER_REPORTS } = require("../utils/reports");

const download_customer_report = (request, res) => send_report_workbook(CUSTOMER_REPORTS, request, res);

module.exports = download_customer_report;
