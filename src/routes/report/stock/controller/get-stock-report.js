const { send_report } = require("../../utils/report-response");
const { STOCK_REPORTS } = require("../utils/reports");

const get_stock_report = (request, res) => send_report(STOCK_REPORTS, request, res);

module.exports = get_stock_report;
