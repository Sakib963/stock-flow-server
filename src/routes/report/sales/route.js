const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { sales_report_schema } = require("./schema");
const get_sales_report = require("./controller/get-sales-report");
const download_sales_report = require("./controller/download-sales-report");

const router = Router();

router.get(ROUTES.GET_SALES_REPORT, [jwtMiddleware, requirePermission("report.sales.view"), validator.get(sales_report_schema)], get_sales_report);

router.get(ROUTES.DOWNLOAD_SALES_REPORT, [jwtMiddleware, requirePermission("report.sales.export"), validator.get(sales_report_schema)], download_sales_report);

module.exports = { salesReportRouter: router };
