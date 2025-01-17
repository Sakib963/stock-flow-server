const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { sub_category_list_schema, sub_category_dropdown_schema, sub_category_schema, sub_category_details_schema } = require("./schema");
const get_sub_category_list = require("./controller/get-sub-category-list");
const get_sub_category_list_for_dropdown = require("./controller/get-sub-category-list-for-dropdown");
const create_sub_category = require("./controller/create-sub-category");
const update_sub_category_details = require("./controller/update-sub-category-details");
const get_sub_category_details = require("./controller/get-sub-category-details");

const router = Router();

// Get Sub Category List
router.get(
      ROUTES.GET_SUB_CATEGORY_LIST,
      [jwtMiddleware, validator.get(sub_category_list_schema)],
      get_sub_category_list
);

// Get Sub Category List for dropdown
router.get(
      ROUTES.GET_SUB_CATEGORY_LIST_FOR_DROPDOWN,
      [jwtMiddleware, validator.get(sub_category_dropdown_schema)],
      get_sub_category_list_for_dropdown
);

// Create A New Sub Category
router.post(
      ROUTES.CREATE_SUB_CATEGORY,
      [jwtMiddleware, validator.post(sub_category_schema)],
      create_sub_category
);

// Update Sub Category
router.post(
      ROUTES.UPDATE_SUB_CATEGORY_DETAILS,
      [jwtMiddleware, validator.post(sub_category_schema)],
      update_sub_category_details
);

// Get Sub Category Details
router.get(
      ROUTES.GET_SUB_CATEGORY_DETAILS,
      [jwtMiddleware, validator.get(sub_category_details_schema)],
      get_sub_category_details
);

module.exports = { subCategoryRouter: router };