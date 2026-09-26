const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../middleware/validate-jwt');
const requirePermission = require('../../../middleware/require-permission');
const { category_list_schema, category_dropdown_schema, category_oid_schema, category_create_schema, category_update_schema, category_details_schema, category_availability_schema, category_code_generate_schema } = require("./schema");
const { validator } = require("../../../middleware/validator");
const get_category_list = require("./controller/get-category-list");
const create_category = require("./controller/create-category");
const update_category_details = require("./controller/update-category-details");
const get_category_details = require("./controller/get-category-details");
const get_category_list_for_dropdown = require("./controller/get-category-list-for-dropdown");
const check_category_availability = require("./controller/check-category-availability");
const generate_category_code = require("./controller/generate-category-code");
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

// The picker behind the sub-category form as well as the category's own screens, so either view
// opens it. A sub-category role without category view would otherwise get an empty parent picker.
router.get(
      ROUTES.GET_CATEGORY_LIST_FOR_DROPDOWN,
      [jwtMiddleware, requirePermission(['configuration.category.view', 'configuration.sub-category.view']), validator.get(category_dropdown_schema)],
      get_category_list_for_dropdown
);

// Is this name or code free? The create and edit form asks as the person types. Both read only
// category data the list already shows, so view is the right gate: anyone who may create or edit
// holds it, because view is what opens the feature at all.
router.get(
      ROUTES.CHECK_CATEGORY_AVAILABILITY,
      [jwtMiddleware, requirePermission('configuration.category.view'), validator.get(category_availability_schema)],
      check_category_availability
);

// Suggest a code for a name. It writes nothing: the person applies it, or ignores it and types
// their own, which is what an owner with codes already in their inventory does.
router.get(
      ROUTES.GENERATE_CATEGORY_CODE,
      [jwtMiddleware, requirePermission('configuration.category.view'), validator.get(category_code_generate_schema)],
      generate_category_code
);

router.post(
      ROUTES.CREATE_CATEGORY,
      [jwtMiddleware, requirePermission('configuration.category.create'), validator.post(category_create_schema)],
      create_category
);

router.post(
      ROUTES.UPDATE_CATEGORY_DETAILS,
      [jwtMiddleware, requirePermission('configuration.category.edit'), validator.post(category_update_schema)],
      update_category_details
);

router.get(
      ROUTES.GET_CATEGORY_DETAILS + "/:oid",
      [jwtMiddleware, requirePermission('configuration.category.view'), validator.params(category_oid_schema)],
      get_category_details
);

router.post(
      ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_CATEGORY,
      [jwtMiddleware, requirePermission('configuration.category.export'), validator.post(category_details_schema)],
      generate_product_list_report_by_category
);

router.post(
      ROUTES.GENERATE_INVENTORY_REPORT_BY_CATEGORY,
      [jwtMiddleware, requirePermission('configuration.category.export'), validator.post(category_details_schema)],
      generate_inventory_report_by_category
);

module.exports = { categoryRouter: router };