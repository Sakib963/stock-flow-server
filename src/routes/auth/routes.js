const { Router } = require("express");
const { loginSchema, refreshSchema, signOutSchema, signOutEverywhereSchema, getSessionsSchema, signOutSessionSchema, forgotPasswordSchema, resetPasswordSchema, userCardSchema } = require("./schema");
const signInUser = require("./controllers/sign-in");
const sign_out = require("./controllers/sign-out");
const sign_out_everywhere = require("./controllers/sign-out-everywhere");
const get_sessions = require("./controllers/get-sessions");
const sign_out_session = require("./controllers/sign-out-session");
const { ROUTES } = require("../../utils/constant");
const refresh_token = require("./controllers/refresh-token");
const get_user_info = require("./controllers/get-user-info");
const forgot_password = require("./controllers/forgot-password");
const reset_password = require("./controllers/reset-password");
const get_user_card = require("./controllers/get-user-card");
const jwtMiddleware = require('../../utils/validate-jwt');
const { validator } = require("../../utils/validator");

const router = Router();

router.post(ROUTES.SIGN_IN, validator.post(loginSchema), signInUser)

// Deliberately without jwtMiddleware, for the same reason as password recovery below: the common
// moment to sign out is coming back to a tab after the 15 minute access token has lapsed. Requiring
// a live one would fail exactly then and leave the session open. The controller finds the session
// from the tokens the request carries.
router.post(ROUTES.SIGN_OUT, validator.post(signOutSchema), sign_out)

// These three are sign-in only, with no permission code, and that is a decision rather than a gap:
// seeing and ending your own sessions is not something a role grants, and nobody should ever be
// unable to lock a lost phone out of their account. Each one only ever touches the caller's own.
router.post(ROUTES.SIGN_OUT_EVERYWHERE, [jwtMiddleware, validator.post(signOutEverywhereSchema)], sign_out_everywhere)

router.get(ROUTES.GET_SESSIONS, [jwtMiddleware, validator.get(getSessionsSchema)], get_sessions)

router.post(ROUTES.SIGN_OUT_SESSION, [jwtMiddleware, validator.post(signOutSessionSchema)], sign_out_session)

router.post(ROUTES.REFRESH_TOKEN, validator.post(refreshSchema), refresh_token)

router.get(ROUTES.GET_USER_INFO, jwtMiddleware, get_user_info)

// Password recovery. Both are deliberately without jwtMiddleware: someone who has forgotten their
// password has no token. That is also why the controllers carry their own throttling, attempt
// caps and neutral responses. Do not relax the profile change-password routes to serve this
// instead: signed-in change and signed-out recovery are different operations with different risk.
router.post(ROUTES.FORGOT_PASSWORD, validator.post(forgotPasswordSchema), forgot_password)

router.post(ROUTES.RESET_PASSWORD, validator.post(resetPasswordSchema), reset_password)

// Who a name in a list belongs to. Sign-in only, alongside the session routes above: the name is
// already on the screen the caller is reading, and reading a colleague's card is not a power a role
// grants. It is not under administration, which is where accounts are created and roles assigned.
router.get(ROUTES.GET_USER_CARD, [jwtMiddleware, validator.get(userCardSchema)], get_user_card)

module.exports = { authRouter: router };
