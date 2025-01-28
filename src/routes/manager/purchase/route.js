const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { purchase_schema } = require("./schema");
const create_purchase = require("./controller/create-purchase");

const router = Router();

// Get Purchase List
/* router.get(
      ROUTES.GET_Purchase_LIST,
      [jwtMiddleware, validator.get(Purchase_list_schema)],
      get_Purchase_list
); */

// Get Purchase List for dropdown
/* router.get(
      ROUTES.GET_Purchase_LIST_FOR_DROPDOWN,
      [jwtMiddleware],
      get_Purchase_list_for_dropdown
); */

// Create A New Purchase
router.post(
      ROUTES.CREATE_PURCHASE,
      [jwtMiddleware, validator.post(purchase_schema)],
      create_purchase
);

// Update New Purchase
/* router.post(
      ROUTES.UPDATE_Purchase_DETAILS,
      [jwtMiddleware, validator.post(Purchase_schema)],
      update_Purchase_details
); */

// Get Purchase Details
/* router.get(
      ROUTES.GET_Purchase_DETAILS,
      [jwtMiddleware, validator.get(Purchase_details_schema)],
      get_Purchase_details
); */

module.exports = { purchaseRouter: router };