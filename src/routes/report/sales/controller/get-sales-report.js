const { send_report } = require("../../utils/report-response");
const { SALES_REPORTS } = require("../utils/reports");

const get_sales_report = (request, res) => send_report(SALES_REPORTS, request, res);

module.exports = get_sales_report;
