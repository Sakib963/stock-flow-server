const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { category_list_schema, category_schema, category_details_schema } = require("./schema");
const { validator } = require("../../../utils/validator");
const get_category_list = require("./controller/get-category-list");
const create_category = require("./controller/create-category");
const update_category_details = require("./controller/update-category-details");
const get_category_details = require("./controller/get-category-details");
const get_category_list_for_dropdown = require("./controller/get-category-list-for-dropdown");

const router = Router();

// Get Category List
router.get(
      ROUTES.GET_CATEGORY_LIST,
      [jwtMiddleware, validator.get(category_list_schema)],
      get_category_list
);

// Get Category List for dropdown
router.get(
      ROUTES.GET_CATEGORY_LIST_FOR_DROPDOWN,
      [jwtMiddleware],
      get_category_list_for_dropdown
);

// Create A New Category
router.post(
      ROUTES.CREATE_CATEGORY,
      [jwtMiddleware, validator.post(category_schema)],
      create_category
);

// Update New Category
router.post(
      ROUTES.UPDATE_CATEGORY_DETAILS,
      [jwtMiddleware, validator.post(category_schema)],
      update_category_details
);

// Get Category Details
router.get(
      ROUTES.GET_CATEGORY_DETAILS,
      [jwtMiddleware, validator.get(category_details_schema)],
      get_category_details
);

module.exports = { categoryRouter: router };