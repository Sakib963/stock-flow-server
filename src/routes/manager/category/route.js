const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { category_list_schema, category_schema, category_details_schema } = require("./schema");
const { validator } = require("../../../utils/validator");
const get_category_list = require("./controller/get-category-list");
const create_category = require("./controller/create-category");
const update_category_details = require("./controller/update-category-details");
const get_category_details = require("./controller/get-category-details");

const router = Router();

// Get User List
router.get(
      ROUTES.GET_CATEGORY_LIST,
      [jwtMiddleware, validator.get(category_list_schema)],
      get_category_list
);

// Create A New User
router.post(
      ROUTES.CREATE_CATEGORY,
      [jwtMiddleware, validator.post(category_schema)],
      create_category
);

// Update New User
router.post(
      ROUTES.UPDATE_CATEGORY_DETAILS,
      [jwtMiddleware, validator.post(category_schema)],
      update_category_details
);

// Get User Details
router.get(
      ROUTES.GET_CATEGORY_DETAILS,
      [jwtMiddleware, validator.get(category_details_schema)],
      get_category_details
);

module.exports = { categoryRouter: router };