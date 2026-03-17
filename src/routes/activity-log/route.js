const { Router } = require("express");
const jwtMiddleware = require("../../utils/validate-jwt");
const { ROUTES } = require("../../utils/constant");
const get_activity_log_list = require("./controller/get-activity-log-list");

const router = Router();

router.post(
  ROUTES.GET_ACTIVITY_LOG_LIST,
  [jwtMiddleware],
  get_activity_log_list,
);

module.exports = { activityLogRouter: router };
