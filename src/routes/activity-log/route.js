const { Router } = require("express");
const { ROUTES } = require("../../utils/constant");
const jwtMiddleware = require("../../middleware/validate-jwt");
const requirePermission = require("../../middleware/require-permission");
const { validator } = require("../../middleware/validator");
const { activity_list_schema, activity_summary_schema } = require("./schema");
const get_activity_log_list = require("./controller/get-activity-log-list");
const get_activity_log_summary = require("./controller/get-activity-log-summary");

const router = Router();

router.get(ROUTES.GET_ACTIVITY_LOG_LIST, [jwtMiddleware, requirePermission("activity-log.activity-log.view"), validator.get(activity_list_schema)], get_activity_log_list);
router.get(ROUTES.GET_ACTIVITY_LOG_SUMMARY, [jwtMiddleware, requirePermission("activity-log.activity-log.view"), validator.get(activity_summary_schema)], get_activity_log_summary);

module.exports = { activityLogRouter: router };
