const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../middleware/validate-jwt');
const requirePermission = require('../../../middleware/require-permission');
const { brand_list_schema, brand_dropdown_schema, brand_oid_schema, brand_create_schema, brand_update_schema, brand_details_schema, brand_availability_schema } = require("./schema");
const { validator } = require("../../../middleware/validator");
const create_brand = require("./controller/create-brand");
const get_brand_list_for_dropdown = require("./controller/get-brand-list-for-dropdown");
const get_brand_list = require("./controller/get-brand-list");
const update_brand_details = require("./controller/update-brand-details");
const get_brand_details = require("./controller/get-brand-details");
const check_brand_availability = require("./controller/check-brand-availability");
const generate_inventory_report_by_brand = require("./controller/generate-inventory-report-by-brand");
const generate_product_list_report_by_brand = require("./controller/generate-product-list-report-by-brand");

const router = Router();

router.get(
      ROUTES.GET_BRANDS_LIST,
      [jwtMiddleware, requirePermission('configuration.brands.view'), validator.get(brand_list_schema)],
      get_brand_list
);

router.get(
      ROUTES.GET_BRANDS_LIST_FOR_DROPDOWN,
      [jwtMiddleware, requirePermission('configuration.brands.view'), validator.get(brand_dropdown_schema)],
      get_brand_list_for_dropdown
);

router.get(
      ROUTES.CHECK_BRAND_AVAILABILITY,
      [jwtMiddleware, requirePermission('configuration.brands.view'), validator.get(brand_availability_schema)],
      check_brand_availability
);

router.post(
      ROUTES.CREATE_BRANDS,
      [jwtMiddleware, requirePermission('configuration.brands.create'), validator.post(brand_create_schema)],
      create_brand
);

router.post(
      ROUTES.UPDATE_BRANDS_DETAILS,
      [jwtMiddleware, requirePermission('configuration.brands.edit'), validator.post(brand_update_schema)],
      update_brand_details
);

router.get(
      ROUTES.GET_BRANDS_DETAILS + "/:oid",
      [jwtMiddleware, requirePermission('configuration.brands.view'), validator.params(brand_oid_schema)],
      get_brand_details
);

router.post(
      ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_BRAND,
      [jwtMiddleware, requirePermission('configuration.brands.export'), validator.post(brand_details_schema)],
      generate_product_list_report_by_brand
);

router.post(
      ROUTES.GENERATE_INVENTORY_REPORT_BY_BRAND,
      [jwtMiddleware, requirePermission('configuration.brands.export'), validator.post(brand_details_schema)],
      generate_inventory_report_by_brand
);

module.exports = { brandRouter: router };
