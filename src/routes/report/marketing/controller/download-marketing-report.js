const { send_report_workbook } = require("../../utils/report-response");
const { MARKETING_REPORTS } = require("../utils/reports");

const download_marketing_report = (request, res) => send_report_workbook(MARKETING_REPORTS, request, res);

module.exports = download_marketing_report;
