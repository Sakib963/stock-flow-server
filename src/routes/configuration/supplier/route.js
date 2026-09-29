const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../middleware/validate-jwt');
const requirePermission = require('../../../middleware/require-permission');
const { validator } = require("../../../middleware/validator");
const { supplier_list_schema, supplier_dropdown_schema, supplier_oid_schema, supplier_create_schema, supplier_update_schema, supplier_availability_schema, supplier_details_schema } = require("./schema");
const get_supplier_list = require("./controller/get-supplier-list");
const create_supplier = require("./controller/create-supplier");
const get_supplier_list_for_dropdown = require("./controller/get-supplier-list-for-dropdown");
const update_supplier_details = require("./controller/update-supplier-details");
const get_supplier_details = require("./controller/get-supplier-details");
const check_supplier_availability = require("./controller/check-supplier-availability");
const generate_supplier_performance_report = require("./controller/generate-supplier-performance-report");
const export_supplier_data = require("./controller/export-supplier-data");

const router = Router();

router.get(
      ROUTES.GET_SUPPLIER_LIST,
      [jwtMiddleware, requirePermission('configuration.supplier.view'), validator.get(supplier_list_schema)],
      get_supplier_list
);

router.get(
      ROUTES.GET_SUPPLIER_LIST_FOR_DROPDOWN,
      [jwtMiddleware, requirePermission(['configuration.supplier.view', 'inventory.purchase-order.view', 'inventory.purchase-order.create', 'inventory.purchase-order.edit']), validator.get(supplier_dropdown_schema)],
      get_supplier_list_for_dropdown
);

router.get(
      ROUTES.CHECK_SUPPLIER_AVAILABILITY,
      [jwtMiddleware, requirePermission('configuration.supplier.view'), validator.get(supplier_availability_schema)],
      check_supplier_availability
);

router.post(
      ROUTES.CREATE_SUPPLIER,
      [jwtMiddleware, requirePermission('configuration.supplier.create'), validator.post(supplier_create_schema)],
      create_supplier
);

router.post(
      ROUTES.UPDATE_SUPPLIER_DETAILS,
      [jwtMiddleware, requirePermission('configuration.supplier.edit'), validator.post(supplier_update_schema)],
      update_supplier_details
);

router.get(
      ROUTES.GET_SUPPLIER_DETAILS + "/:oid",
      [jwtMiddleware, requirePermission('configuration.supplier.view'), validator.params(supplier_oid_schema)],
      get_supplier_details
);

router.post(
      ROUTES.GENERATE_SUPPLIER_PERFORMANCE_REPORT,
      [jwtMiddleware, requirePermission('configuration.supplier.export'), validator.post(supplier_details_schema)],
      generate_supplier_performance_report
);

router.post(
      ROUTES.EXPORT_SUPPLIER_DATA,
      [jwtMiddleware, requirePermission('configuration.supplier.export'), validator.post(supplier_details_schema)],
      export_supplier_data
);

module.exports = { supplierRouter: router };
