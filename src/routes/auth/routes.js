const { Router } = require("express");
const { loginSchema, refreshSchema, signOutSchema, forgotPasswordSchema, resetPasswordSchema } = require("./schema");
const signInUser = require("./controllers/sign-in");
const sign_out = require("./controllers/sign-out");
const { ROUTES } = require("../../utils/constant");
const refresh_token = require("./controllers/refresh-token");
const get_user_info = require("./controllers/get-user-info");
const forgot_password = require("./controllers/forgot-password");
const reset_password = require("./controllers/reset-password");
const jwtMiddleware = require('../../utils/validate-jwt');
const { validator } = require("../../utils/validator");

const router = Router();

router.post(ROUTES.SIGN_IN, validator.post(loginSchema), signInUser)

// Deliberately without jwtMiddleware, for the same reason as password recovery below: the
// common moment to sign out is coming back to a tab after lunch, when the 30 minute access token
// has already expired. Requiring a live one would fail exactly then and leave the row open with a
// refresh token good for another 7 days, which is the hole this endpoint exists to close. The
// tokens in the request are the authorisation: holding one is what lets you end its session, and
// ending a session is not something an attacker who holds it gains anything from.
router.post(ROUTES.SIGN_OUT, validator.post(signOutSchema), sign_out)

router.post(ROUTES.REFRESH_TOKEN, validator.post(refreshSchema), refresh_token)

router.get(ROUTES.GET_USER_INFO, jwtMiddleware, get_user_info)

// Password recovery. Both are deliberately without jwtMiddleware: someone who has forgotten their
// password has no token. That is also why the controllers carry their own throttling, attempt
// caps and neutral responses. Do not relax the profile change-password routes to serve this
// instead: signed-in change and signed-out recovery are different operations with different risk.
router.post(ROUTES.FORGOT_PASSWORD, validator.post(forgotPasswordSchema), forgot_password)

router.post(ROUTES.RESET_PASSWORD, validator.post(resetPasswordSchema), reset_password)

module.exports = { authRouter: router };
