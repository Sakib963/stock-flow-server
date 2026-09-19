const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const requirePermission = require('../../../utils/require-permission');
const { category_list_schema, category_dropdown_schema, category_oid_schema, category_schema, category_details_schema } = require("./schema");
const { validator } = require("../../../utils/validator");
const get_category_list = require("./controller/get-category-list");
const create_category = require("./controller/create-category");
const update_category_details = require("./controller/update-category-details");
const get_category_details = require("./controller/get-category-details");
const get_category_list_for_dropdown = require("./controller/get-category-list-for-dropdown");
const ExcelJS = require("exceljs");
const generate_inventory_report_by_category = require("./controller/generate-inventory-report-by-category");
const generate_product_list_report_by_category = require("./controller/generate-product-list-report-by-category");

const router = Router();

// Get Category List. Guarded now because the rebuilt Categories list reads it; the rest of this
// router is guarded when Configuration is ported.
router.get(
      ROUTES.GET_CATEGORY_LIST,
      [jwtMiddleware, requirePermission('configuration.category.view'), validator.get(category_list_schema)],
      get_category_list
);

// Get Category List for dropdown
router.get(
      ROUTES.GET_CATEGORY_LIST_FOR_DROPDOWN,
      [jwtMiddleware, requirePermission('configuration.category.view'), validator.get(category_dropdown_schema)],
      get_category_list_for_dropdown
);

// Create A New Category
router.post(
      ROUTES.CREATE_CATEGORY,
      [jwtMiddleware, requirePermission('configuration.category.create'), validator.post(category_schema)],
      create_category
);

// Update New Category
router.post(
      ROUTES.UPDATE_CATEGORY_DETAILS,
      [jwtMiddleware, requirePermission('configuration.category.edit'), validator.post(category_schema)],
      update_category_details
);

// Get Category Details
router.get(
      ROUTES.GET_CATEGORY_DETAILS + "/:oid",
      [jwtMiddleware, requirePermission('configuration.category.view'), validator.params(category_oid_schema)],
      get_category_details
);

// Generate Product List Report by Category
router.post(
      ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_CATEGORY,
      [jwtMiddleware, requirePermission('configuration.category.export'), validator.post(category_details_schema)],
      generate_product_list_report_by_category
);

// Generate Inventory Report by Category
router.post(
      ROUTES.GENERATE_INVENTORY_REPORT_BY_CATEGORY,
      [jwtMiddleware, requirePermission('configuration.category.export'), validator.post(category_details_schema)],
      generate_inventory_report_by_category
);

module.exports = { categoryRouter: router };