const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { supplier_dealer_list_schema, supplier_dealer_schema, supplier_dealer_details_schema, supplier_dealer_dropdown_schema } = require("./schema");
const create_supplier_dealer = require("./controller/create-supplier-dealer");
const get_supplier_dealer_details = require("./controller/get-supplier-dealer-details");
const get_supplier_dealer_list = require("./controller/get-supplier-dealer-list");
const update_supplier_dealer_details = require("./controller/update-supplier-dealer-details");
const get_supplier_dealer_list_for_dropdown = require("./controller/get-supplier-dealer-list-for-dropdown");

const router = Router();

// Get Supplier/Dealer List
router.get(
      ROUTES.GET_SUPPLIER_DEALER_LIST,
      [jwtMiddleware, validator.get(supplier_dealer_list_schema)],
      get_supplier_dealer_list
);

// Get Supplier/Dealer List for dropdown
router.get(
      ROUTES.GET_SUPPLIER_DEALER_LIST_FOR_DROPDOWN,
      [jwtMiddleware, validator.get(supplier_dealer_dropdown_schema)],
      get_supplier_dealer_list_for_dropdown
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