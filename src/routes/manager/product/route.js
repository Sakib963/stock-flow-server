const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { product_list_schema, product_schema, product_details_schema } = require("./schema");
const { validator } = require("../../../utils/validator");
const get_product_list = require("./controller/get-product-list");
const get_product_list_for_dropdown = require("./controller/get-product-list-for-dropdown");
const create_product = require("./controller/create-product");
const update_product_details = require("./controller/update-product-details");
const get_product_details = require("./controller/get-product-details");
const delete_product = require("./controller/delete-product");

const router = Router();

// Get Product List
router.get(
      ROUTES.GET_PRODUCT_LIST,
      [jwtMiddleware, validator.get(product_list_schema)],
      get_product_list
);

// Get Product List for dropdown
router.get(
      ROUTES.GET_PRODUCT_LIST_FOR_DROPDOWN,
      [jwtMiddleware],
      get_product_list_for_dropdown
);

// Create A New Product
router.post(
      ROUTES.CREATE_PRODUCT,
      [jwtMiddleware, validator.post(product_schema)],
      create_product
);

// Update New Product
router.post(
      ROUTES.UPDATE_PRODUCT_DETAILS,
      [jwtMiddleware, validator.post(product_schema)],
      update_product_details
);

// Get Product Details
router.get(
      ROUTES.GET_PRODUCT_DETAILS,
      [jwtMiddleware, validator.get(product_details_schema)],
      get_product_details
);

// Delete Product
router.get(
      ROUTES.DELETE_PRODUCT,
      [jwtMiddleware, validator.get(product_details_schema)],
      delete_product
);

module.exports = { productRouter: router };