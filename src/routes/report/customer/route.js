const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { customer_report_schema } = require("./schema");
const get_customer_report = require("./controller/get-customer-report");
const download_customer_report = require("./controller/download-customer-report");

const router = Router();

router.get(ROUTES.GET_CUSTOMER_REPORT, [jwtMiddleware, requirePermission("report.customer.view"), validator.get(customer_report_schema)], get_customer_report);

router.get(ROUTES.DOWNLOAD_CUSTOMER_REPORT, [jwtMiddleware, requirePermission("report.customer.export"), validator.get(customer_report_schema)], download_customer_report);

module.exports = { customerReportRouter: router };
