const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { attendance_schema, attendance_list_schema, attendance_status_schema } = require("./schema");
const update_attendance = require("./controller/update-attendance");
const get_attendance_list = require("./controller/get-attendance-list");
const check_current_attendance_status = require("./controller/check-current-attendance-status");

const router = Router();

// Get Attendance List
router.get(
      ROUTES.GET_ATTENDANCE_LIST,
      [jwtMiddleware, validator.get(attendance_list_schema)],
      get_attendance_list
);
// Check Current Attendance Status
router.get(
      ROUTES.CHECK_CURRENT_ATTENDANCE_STATUS,
      [jwtMiddleware, validator.get(attendance_status_schema)],
      check_current_attendance_status
);

// Create A New Attendance
router.post(
      ROUTES.UPDATE_ATTENDANCE,
      [jwtMiddleware, validator.post(attendance_schema)],
      update_attendance
);

module.exports = { attendanceRouter: router };