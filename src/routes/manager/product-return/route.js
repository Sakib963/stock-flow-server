const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { product_return_list_schema, product_return_details_schema } = require("./schema");
const get_product_return_list = require("./controller/get-product-return-list");
const get_product_return_details = require("./controller/get-product-return-details");

const router = Router();

// Get Product Return List
router.get(
      ROUTES.GET_PRODUCT_RETURN_LIST,
      [jwtMiddleware, validator.get(product_return_list_schema)],
      get_product_return_list
);

// Get Product Return Details
router.get(
      ROUTES.GET_PRODUCT_RETURN_DETAILS,
      [jwtMiddleware, validator.get(product_return_details_schema)],
      get_product_return_details
);

module.exports = { productReturnRouter: router };