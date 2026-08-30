const { Router } = require("express");
const { loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema } = require("./schema");
const signInUser = require("./controllers/sign-in");
const { ROUTES } = require("../../utils/constant");
const refresh_token = require("./controllers/refresh-token");
const get_user_info = require("./controllers/get-user-info");
const forgot_password = require("./controllers/forgot-password");
const reset_password = require("./controllers/reset-password");
const jwtMiddleware = require('../../utils/validate-jwt');
const { validator } = require("../../utils/validator");

const router = Router();

router.post(ROUTES.SIGN_IN, validator.post(loginSchema), signInUser)

router.post(ROUTES.REFRESH_TOKEN, validator.post(refreshSchema), refresh_token)

router.get(ROUTES.GET_USER_INFO, jwtMiddleware, get_user_info)

// Password recovery. Both are deliberately without jwtMiddleware: someone who has forgotten their
// password has no token. That is also why the controllers carry their own throttling, attempt
// caps and neutral responses. Do not relax the profile change-password routes to serve this
// instead: signed-in change and signed-out recovery are different operations with different risk.
router.post(ROUTES.FORGOT_PASSWORD, validator.post(forgotPasswordSchema), forgot_password)

router.post(ROUTES.RESET_PASSWORD, validator.post(resetPasswordSchema), reset_password)

module.exports = { authRouter: router };
