const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { product_dispose_list_schema, product_dispose_schema, product_dispose_details_schema } = require("./schema");
const { validator } = require("../../../utils/validator");
const get_product_dispose_list = require("./controller/get-product-dispose-list");
const get_product_list_for_dispose_dropdown = require("./controller/get-product-dispose-list-for-dropdown");
const create_product_dispose = require("./controller/create-product-dispose");
const get_product_dispose_details = require("./controller/get-product-dispose-details");

const router = Router();

// Get Product List
router.get(
      ROUTES.GET_PRODUCT_DISPOSE_LIST,
      [jwtMiddleware, validator.get(product_dispose_list_schema)],
      get_product_dispose_list
);

// Get Product List for dropdown
router.get(
      ROUTES.GET_PRODUCT_LIST_FOR_DISPOSE_DROPDOWN,
      [jwtMiddleware],
      get_product_list_for_dispose_dropdown
);

// Create A New Product
router.post(
      ROUTES.CREATE_PRODUCT_DISPOSE,
      [jwtMiddleware, validator.post(product_dispose_schema)],
      create_product_dispose
);

// Get Product Details
router.get(
      ROUTES.GET_PRODUCT_DISPOSE_DETAILS,
      [jwtMiddleware, validator.get(product_dispose_details_schema)],
      get_product_dispose_details
);

module.exports = { disposeRouter: router };