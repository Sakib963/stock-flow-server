const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { marketing_report_schema } = require("./schema");
const get_marketing_report = require("./controller/get-marketing-report");
const download_marketing_report = require("./controller/download-marketing-report");

const router = Router();

router.get(ROUTES.GET_MARKETING_REPORT, [jwtMiddleware, requirePermission("report.marketing.view"), validator.get(marketing_report_schema)], get_marketing_report);

router.get(ROUTES.DOWNLOAD_MARKETING_REPORT, [jwtMiddleware, requirePermission("report.marketing.export"), validator.get(marketing_report_schema)], download_marketing_report);

module.exports = { marketingReportRouter: router };
