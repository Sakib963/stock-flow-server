const { send_report } = require("../../utils/report-response");
const { CUSTOMER_REPORTS } = require("../utils/reports");

const get_customer_report = (request, res) => send_report(CUSTOMER_REPORTS, request, res);

module.exports = get_customer_report;
