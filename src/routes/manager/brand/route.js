const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { brand_list_schema, brand_schema, brand_details_schema } = require("./schema");
const { validator } = require("../../../utils/validator");
const get_brand_list = require("./controller/get-brand-list");
const get_brand_list_for_dropdown = require("./controller/get-brand-list-for-dropdown");
const create_brand = require("./controller/create-brand");
const update_brand_details = require("./controller/update-brand-details");
const get_brand_details = require("./controller/get-brand-details");

const router = Router();

// Get brand List
router.get(
      ROUTES.GET_BRANDS_LIST,
      [jwtMiddleware, validator.get(brand_list_schema)],
      get_brand_list
);

// Get brand List for dropdown
router.get(
      ROUTES.GET_BRANDS_LIST_FOR_DROPDOWN,
      [jwtMiddleware],
      get_brand_list_for_dropdown
);

// Create A New brand
router.post(
      ROUTES.CREATE_BRANDS,
      [jwtMiddleware, validator.post(brand_schema)],
      create_brand
);

// Update New brand
router.post(
      ROUTES.UPDATE_BRANDS_DETAILS,
      [jwtMiddleware, validator.post(brand_schema)],
      update_brand_details
);

// Get brand Details
router.get(
      ROUTES.GET_BRANDS_DETAILS,
      [jwtMiddleware, validator.get(brand_details_schema)],
      get_brand_details
);

module.exports = { brandRouter: router };