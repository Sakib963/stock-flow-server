const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { attendance_schema, attendance_list_schema } = require("./schema");
const get_employee_attendance_list = require("./controller/get-employee-attendance-list");
const update_employee_attendance = require("./controller/update-employee-attendance");

const router = Router();

// Get Attendance List
router.get(
      ROUTES.GET_EMPLOYEE_ATTENDANCE_LIST,
      [jwtMiddleware, validator.get(attendance_list_schema)],
      get_employee_attendance_list
);

// Update Attendance
router.post(
      ROUTES.UPDATE_EMPLOYEE_ATTENDANCE,
      [jwtMiddleware, validator.post(attendance_schema)],
      update_employee_attendance
);

module.exports = { attendanceRouter: router };