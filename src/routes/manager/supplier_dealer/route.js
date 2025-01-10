const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { supplier_dealer_list_schema, supplier_dealer_schema, supplier_dealer_details_schema } = require("./schema");
const create_supplier_dealer = require("./controller/create-supplier-dealer");
const get_supplier_dealer_details = require("./controller/get-supplier-dealer-details");
const get_supplier_dealer_list = require("./controller/get-supplier-dealer-list");
const update_supplier_dealer_details = require("./controller/update-supplier-dealer-details");

const router = Router();

// Get Supplier/Dealer List
router.get(
      ROUTES.GET_SUPPLIER_DEALER_LIST,
      [jwtMiddleware, validator.get(supplier_dealer_list_schema)],
      get_supplier_dealer_list
);

// Create A Supplier/Dealer
router.post(
      ROUTES.CREATE_SUPPLIER_DEALER,
      [jwtMiddleware, validator.post(supplier_dealer_schema)],
      create_supplier_dealer
);

// Update Supplier/Dealer
router.post(
      ROUTES.UPDATE_SUPPLIER_DEALER_DETAILS,
      [jwtMiddleware, validator.post(supplier_dealer_schema)],
      update_supplier_dealer_details
);

// Get Supplier/Dealer Details
router.get(
      ROUTES.GET_SUPPLIER_DEALER_DETAILS,
      [jwtMiddleware, validator.get(supplier_dealer_details_schema)],
      get_supplier_dealer_details
);

module.exports = { supplier_dealer_router: router };