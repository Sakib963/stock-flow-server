const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const { validator } = require("../../../middleware/validator");
const { crash_report_schema } = require("./schema");
const report_crash = require("./controllers/report-crash");

// Signed in, no permission, as with a person's notes (decided 2026-10-20). It stores nothing itself: the
// request log keeps the request and its body, which is the report.
const router = Router();

router.post(ROUTES.REPORT_CRASH, [jwtMiddleware, validator.post(crash_report_schema)], report_crash);

module.exports = { crashReportRouter: router };
