const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const {  change_password_schema, verify_otp_for_password_change_schema } = require("./schema");
const change_password = require("./controllers/change-password");
const verify_otp_for_password_change = require("./controllers/verify-otp-for-password-change");

const router = Router();

// Change User Password
router.post(
      ROUTES.CHANGE_PASSWORD,
      [jwtMiddleware, validator.post(change_password_schema)],
      change_password
);

router.post(ROUTES.VERIFY_OTP_FOR_PASSWORD_CHANGE,
      [jwtMiddleware, validator.post(verify_otp_for_password_change_schema)],
      verify_otp_for_password_change
)

// Get Aisle Details
/* router.get(
      ROUTES.GET_AISLE_DETAILS,
      [jwtMiddleware, validator.get(aisle_details_schema)],
      get_aisle_details
);
 */
module.exports = { changePasswordRouter: router };