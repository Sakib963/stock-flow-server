const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { purchase_schema, purchase_list_schema, purchase_details_schema } = require("./schema");
const create_purchase = require("./controller/create-purchase");
const get_purchase_list = require("./controller/get-purchase-list");
const get_purchase_details = require("./controller/get-purchase-details");
const update_purchase_details = require("./controller/update-purchase-details");

const router = Router();

// Get Purchase List
router.get(
      ROUTES.GET_PURCHASE_LIST,
      [jwtMiddleware, validator.get(purchase_list_schema)],
      get_purchase_list
);

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

// Update Purchase
router.post(
      ROUTES.UPDATE_PURCHASE_DETAILS,
      [jwtMiddleware, validator.post(purchase_schema)],
      update_purchase_details
);

// Get Purchase Details
router.get(
      ROUTES.GET_PURCHASE_DETAILS,
      [jwtMiddleware, validator.get(purchase_details_schema)],
      get_purchase_details
);

module.exports = { purchaseRouter: router };