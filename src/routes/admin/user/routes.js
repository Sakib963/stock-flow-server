const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const get_user_list = require("./controller/get-user-list");
const { user_list_schema } = require("./schema");
const { validator } = require("../../../utils/validator");

const router = Router();

router.get(
      ROUTES.GET_USER_LIST,
      [jwtMiddleware, validator.get(user_list_schema)],
      get_user_list
);

module.exports = { userRouter: router };