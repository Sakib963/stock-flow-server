const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const get_user_list = require("./controller/get-user-list");
const { user_list_schema, create_user_schema, user_details_schema, update_user_schema } = require("./schema");
const { validator } = require("../../../utils/validator");
const create_user = require("./controller/create-user");
const get_user_details = require("./controller/get-user-details");
const update_user_details = require("./controller/update-user-details");

const router = Router();

// Get User List
router.get(
      ROUTES.GET_USER_LIST,
      [jwtMiddleware, validator.get(user_list_schema)],
      get_user_list
);

// Create A New User
router.post(
      ROUTES.CREATE_USER,
      [jwtMiddleware, validator.post(create_user_schema)],
      create_user
);

// Update New User
router.post(
      ROUTES.UPDATE_USER_DETAILS,
      [jwtMiddleware, validator.post(update_user_schema)],
      update_user_details
);

// Get User Details
router.get(
      ROUTES.GET_USER_DETAILS,
      [jwtMiddleware, validator.get(user_details_schema)],
      get_user_details
);

module.exports = { userRouter: router };