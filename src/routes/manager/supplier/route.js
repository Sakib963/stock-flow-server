const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { supplier_list_schema, supplier_schema, supplier_details_schema } = require("./schema");
const get_supplier_list = require("./controller/get-supplier-list");
const create_supplier = require("./controller/create-supplier");
const update_supplier_details = require("./controller/update-supplier-details");
const get_supplier_details = require("./controller/get-supplier-details");
const get_supplier_list_for_dropdown = require("./controller/get-supplier-list-for-dropdown");

const router = Router();

// Get Supplier List
router.get(
      ROUTES.GET_SUPPLIER_LIST,
      [jwtMiddleware, validator.get(supplier_list_schema)],
      get_supplier_list
);

// Get Supplier List for dropdown
router.get(
      ROUTES.GET_SUPPLIER_LIST_FOR_DROPDOWN,
      [jwtMiddleware],
      get_supplier_list_for_dropdown
);

// Create A Supplier
router.post(
      ROUTES.CREATE_SUPPLIER,
      [jwtMiddleware, validator.post(supplier_schema)],
      create_supplier
);

// Update Supplier
router.post(
      ROUTES.UPDATE_SUPPLIER_DETAILS,
      [jwtMiddleware, validator.post(supplier_schema)],
      update_supplier_details
);

// Get Supplier Details
router.get(
      ROUTES.GET_SUPPLIER_DETAILS,
      [jwtMiddleware, validator.get(supplier_details_schema)],
      get_supplier_details
);

module.exports = { supplier_router: router };