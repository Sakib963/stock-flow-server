const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { price_fixation_details_schema, price_fixation_list_schema } = require("./schema");
const get_price_fixation_product_list = require("./controller/get-price-fixation-product-list");
const get_price_fixation_product_batches = require("./controller/get_price_fixation_product_batches");

const router = Router();

// Get product List for price fixation
router.get(
      ROUTES.GET_PRICE_FIXATION_PRODUCT_LIST,
      [jwtMiddleware, validator.get(price_fixation_list_schema)],
      get_price_fixation_product_list
);

// Get Purchase Details
router.get(
      ROUTES.GET_PRODUCT_BATCHES_FOR_PRICE_FIXATION,
      [jwtMiddleware, validator.get(price_fixation_details_schema)],
      get_price_fixation_product_batches
);

module.exports = { priceFixationRouter: router };