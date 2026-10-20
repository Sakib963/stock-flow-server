const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { stock_report_schema } = require("./schema");
const get_stock_report = require("./controller/get-stock-report");
const download_stock_report = require("./controller/download-stock-report");

const router = Router();

router.get(ROUTES.GET_STOCK_REPORT, [jwtMiddleware, requirePermission("report.stock.view"), validator.get(stock_report_schema)], get_stock_report);

router.get(ROUTES.DOWNLOAD_STOCK_REPORT, [jwtMiddleware, requirePermission("report.stock.export"), validator.get(stock_report_schema)], download_stock_report);

module.exports = { stockReportRouter: router };
