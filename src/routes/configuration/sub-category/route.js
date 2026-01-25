const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { sub_category_list_schema, sub_category_schema, sub_category_details_schema } = require("./schema");
const { validator } = require("../../../utils/validator");
const create_sub_category = require("./controller/create-sub-category");
const get_sub_category_details = require("./controller/get-sub-category-details");
const get_sub_category_list = require("./controller/get-sub-category-list");
const generate_inventory_report_by_sub_category = require("./controller/generate-inventory-report-by-sub-category");
const get_sub_category_list_for_dropdown = require("./controller/get-sub-category-list-for-dropdown");
const generate_product_list_report_by_sub_category = require("./controller/generate-product-list-report-by-sub-category");
const update_sub_category_details = require("./controller/update-sub-category-details");

const router = Router();

// Get Sub-Category List
router.get(
      ROUTES.GET_SUB_CATEGORY_LIST,
      [jwtMiddleware, validator.get(sub_category_list_schema)],
      get_sub_category_list
);

// Get Sub-Category List for dropdown
router.get(
      ROUTES.GET_SUB_CATEGORY_LIST_FOR_DROPDOWN,
      [jwtMiddleware],
      get_sub_category_list_for_dropdown
);

// Create A New Sub-Category
router.post(
      ROUTES.CREATE_SUB_CATEGORY,
      [jwtMiddleware, validator.post(sub_category_schema)],
      create_sub_category
);

// Update New Sub-Category
router.post(
      ROUTES.UPDATE_SUB_CATEGORY_DETAILS,
      [jwtMiddleware, validator.post(sub_category_schema)],
      update_sub_category_details
);

// Get Sub-Category Details
router.get(
      ROUTES.GET_SUB_CATEGORY_DETAILS + "/:oid",
      [jwtMiddleware],
      get_sub_category_details
);

// Generate Product List Report by Sub-Category
router.post(
      ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_SUB_CATEGORY,
      [jwtMiddleware, validator.post(sub_category_details_schema)],
      generate_product_list_report_by_sub_category
);

// Generate Inventory Report by Sub-Category
router.post(
      ROUTES.GENERATE_INVENTORY_REPORT_BY_SUB_CATEGORY,
      [jwtMiddleware, validator.post(sub_category_details_schema)],
      generate_inventory_report_by_sub_category
);

module.exports = { subCategoryRouter: router };