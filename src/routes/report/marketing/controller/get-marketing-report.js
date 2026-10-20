const { send_report } = require("../../utils/report-response");
const { MARKETING_REPORTS } = require("../utils/reports");

const get_marketing_report = (request, res) => send_report(MARKETING_REPORTS, request, res);

module.exports = get_marketing_report;
