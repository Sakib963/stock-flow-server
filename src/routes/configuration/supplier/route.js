const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { supplier_list_schema, supplier_schema, supplier_details_schema } = require("./schema");
const get_supplier_list = require("./controller/get-supplier-list");
const create_supplier = require("./controller/create-supplier");
const get_supplier_list_for_dropdown = require("./controller/get-supplier-list-for-dropdown");
const update_supplier_details = require("./controller/update-supplier-details");
const get_supplier_details = require("./controller/get-supplier-details");

const router = Router();

// Get Category List
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

// Create A New Supplier
router.post(
      ROUTES.CREATE_SUPPLIER,
      [jwtMiddleware, validator.post(supplier_schema)],
      create_supplier
);

// Update New Supplier
router.post(
      ROUTES.UPDATE_SUPPLIER_DETAILS,
      [jwtMiddleware, validator.post(supplier_schema)],
      update_supplier_details
);

// Get Supplier Details
router.get(
      ROUTES.GET_SUPPLIER_DETAILS + "/:oid",
      [jwtMiddleware, validator.get(supplier_details_schema)],
      get_supplier_details
);

// // Generate Product List Report by Supplier
// router.post(
//       ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_CATEGORY,
//       [jwtMiddleware, validator.post(category_details_schema)],
//       generate_product_list_report_by_category
// );

// // Generate Inventory Report by Category
// router.post(
//       ROUTES.GENERATE_INVENTORY_REPORT_BY_CATEGORY,
//       [jwtMiddleware, validator.post(category_details_schema)],
//       generate_inventory_report_by_category
// );

module.exports = { supplierRouter: router };