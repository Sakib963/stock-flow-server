const { Router } = require("express");
const { loginSchema, refreshSchema } = require("./schema");
const validateRequest = require("../../utils/validator");
const signInUser = require("./controllers/sign-in");
const { ROUTES } = require("../../utils/constant");
const refresh_token = require("./controllers/refresh-token");
const get_user_info = require("./controllers/get-user-info");
const jwtMiddleware = require('../../utils/validate-jwt')

const router = Router();

router.post(ROUTES.SIGN_IN, validateRequest(loginSchema), signInUser)

router.post(ROUTES.REFRESH_TOKEN, validateRequest(refreshSchema), refresh_token)

router.get(ROUTES.GET_USER_INFO, jwtMiddleware, get_user_info)

module.exports = router;