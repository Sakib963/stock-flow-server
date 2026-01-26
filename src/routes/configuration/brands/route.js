const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { brand_list_schema, brand_schema, brand_details_schema } = require("./schema");
const { validator } = require("../../../utils/validator");
const create_brand = require("./controller/create-brand");
const get_brand_list_for_dropdown = require("./controller/get-brand-list-for-dropdown");
const get_brand_list = require("./controller/get-brand-list");
const update_brand_details = require("./controller/update-brand-details");
const get_brand_details = require("./controller/get-brand-details");
const generate_inventory_report_by_brand = require("./controller/generate-inventory-report-by-brand");
const generate_product_list_report_by_brand = require("./controller/generate-product-list-report-by-brand");

const router = Router();

// Get Brand List
router.get(
      ROUTES.GET_BRANDS_LIST,
      [jwtMiddleware, validator.get(brand_list_schema)],
      get_brand_list
);

// Get Brand List for dropdown
router.get(
      ROUTES.GET_BRANDS_LIST_FOR_DROPDOWN,
      [jwtMiddleware],
      get_brand_list_for_dropdown
);

// Create A New Brand
router.post(
      ROUTES.CREATE_BRANDS,
      [jwtMiddleware, validator.post(brand_schema)],
      create_brand
);

// Update New Brand
router.post(
      ROUTES.UPDATE_BRANDS_DETAILS,
      [jwtMiddleware, validator.post(brand_schema)],
      update_brand_details
);

// Get Brand Details
router.get(
      ROUTES.GET_BRANDS_DETAILS + "/:oid",
      [jwtMiddleware],
      get_brand_details
);

// Generate Product List Report by Brand
router.post(
      ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_BRAND,
      [jwtMiddleware, validator.post(brand_details_schema)],
      generate_product_list_report_by_brand
);

// Generate Inventory Report by Brand
router.post(
      ROUTES.GENERATE_INVENTORY_REPORT_BY_BRAND,
      [jwtMiddleware, validator.post(brand_details_schema)],
      generate_inventory_report_by_brand
);

module.exports = { brandRouter: router };