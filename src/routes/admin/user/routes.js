const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const requirePermission = require('../../../utils/require-permission');
const get_user_list = require("./controller/get-user-list");
const { user_list_schema, create_user_schema, user_details_schema, update_user_schema } = require("./schema");
const { validator } = require("../../../utils/validator");
const create_user = require("./controller/create-user");
const get_user_details = require("./controller/get-user-details");
const update_user_details = require("./controller/update-user-details");

const router = Router();

// These are guarded first, ahead of every other module, because they are the endpoints that let
// someone grant themselves everything else. Until now any signed-in user could call create-user.

// Get User List
router.get(
      ROUTES.GET_USER_LIST,
      [jwtMiddleware, requirePermission('administration.user.view'), validator.get(user_list_schema)],
      get_user_list
);

// Create A New User
router.post(
      ROUTES.CREATE_USER,
      [jwtMiddleware, requirePermission('administration.user.create'), validator.post(create_user_schema)],
      create_user
);

// Update New User
router.post(
      ROUTES.UPDATE_USER_DETAILS,
      [jwtMiddleware, requirePermission('administration.user.edit'), validator.post(update_user_schema)],
      update_user_details
);

// Get User Details
router.get(
      ROUTES.GET_USER_DETAILS,
      [jwtMiddleware, requirePermission('administration.user.view'), validator.get(user_details_schema)],
      get_user_details
);

module.exports = { userRouter: router };
