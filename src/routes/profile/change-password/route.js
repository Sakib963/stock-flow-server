const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const { validator } = require("../../../middleware/validator");
const { change_password_schema, verify_otp_for_password_change_schema } = require("./schema");
const change_password = require("./controllers/change-password");
const verify_otp_for_password_change = require("./controllers/verify-otp-for-password-change");

// A person's own password, with no permission on purpose: every signed-in person must be able to
// change it, and both steps act only on the caller's own account.
const router = Router();

router.post(ROUTES.CHANGE_PASSWORD, [jwtMiddleware, validator.post(change_password_schema)], change_password);
router.post(ROUTES.VERIFY_OTP_FOR_PASSWORD_CHANGE, [jwtMiddleware, validator.post(verify_otp_for_password_change_schema)], verify_otp_for_password_change);

module.exports = { changePasswordRouter: router };
