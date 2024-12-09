const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const get_user_list = require("./controller/get-user-list");
const { user_list_schema, user_form_schema } = require("./schema");
const { validator } = require("../../../utils/validator");
const create_user = require("./controller/create-user");

const router = Router();

router.get(
      ROUTES.GET_USER_LIST,
      [jwtMiddleware, validator.get(user_list_schema)],
      get_user_list
);

router.post(
      ROUTES.CREATE_USER,
      [jwtMiddleware, validator.post(user_form_schema)],
      create_user
);

module.exports = { userRouter: router };