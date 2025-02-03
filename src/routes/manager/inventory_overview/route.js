const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const get_product_list = require("./controller/get-product-list");
const { overview_details_schema, overview_list_schema } = require("./schema");
const get_product_details = require("./controller/get-product-details");

const router = Router();

// Get product List
router.get(
      ROUTES.GET_PRODUCT_LIST_FOR_OVERVIEW,
      [jwtMiddleware, validator.get(overview_list_schema)],
      get_product_list
);

// Get Purchase Details
router.get(
      ROUTES.GET_PRODUCT_DETAILS_FOR_OVERVIEW,
      [jwtMiddleware, validator.get(overview_details_schema)],
      get_product_details
);

module.exports = { inventoryOverviewRouter: router };