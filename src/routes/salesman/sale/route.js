const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { product_list_schema } = require("./schema");
const get_product_list = require("./controller/get-product-list");
const get_invoice_number = require("./controller/get-invoice-number");

const router = Router();

// Get Product List
router.get(
      ROUTES.GET_PRODUCT_LIST,
      [jwtMiddleware, validator.get(product_list_schema)],
      get_product_list
);

// Get Invoice Number
router.get(
      ROUTES.GET_INVOICE_NUMBER,
      [jwtMiddleware],
      get_invoice_number
);
// Check Current Product Status
/* router.get(
      ROUTES.CHECK_CURRENT_ATTENDANCE_STATUS,
      [jwtMiddleware, validator.get(attendance_status_schema)],
      check_current_attendance_status
);
 */
// Create A New Attendance
/* router.post(
      ROUTES.UPDATE_ATTENDANCE,
      [jwtMiddleware, validator.post(attendance_schema)],
      update_attendance
); */

module.exports = { saleRouter: router };