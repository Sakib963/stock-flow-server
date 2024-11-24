const { Router } = require("express");
const { loginSchema, refreshSchema } = require("./schema");
const signInUser = require("./controllers/sign-in");
const { ROUTES } = require("../../utils/constant");
const refresh_token = require("./controllers/refresh-token");
const get_user_info = require("./controllers/get-user-info");
const jwtMiddleware = require('../../utils/validate-jwt');
const { validator } = require("../../utils/validator");

const router = Router();

router.post(ROUTES.SIGN_IN, validator.post(loginSchema), signInUser)

router.post(ROUTES.REFRESH_TOKEN, validator.post(refreshSchema), refresh_token)

router.get(ROUTES.GET_USER_INFO, jwtMiddleware, get_user_info)

module.exports = { authRouter: router };