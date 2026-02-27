const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../utils/validate-jwt");
const {
  warehouse_schema,
  warehouse_details_schema,
  warehouse_list_schema,
} = require("./schema");
const { validator } = require("../../../utils/validator");
const get_warehouse_list = require("./controller/get-warehouse-list");
const get_warehouse_details = require("./controller/get-warehouse-details");
const create_warehouse = require("./controller/create-warehouse");
const update_warehouse_details = require("./controller/update-warehouse-details");
const get_warehouse_list_for_dropdown = require("./controller/get-warehouse-list-for-dropdown");
const generate_inventory_report_by_warehouse = require("./controller/generate-inventory-report-by-warehouse");
const generate_product_list_report_by_warehouse = require("./controller/generate-product-list-report-by-warehouse");
const router = Router();

// Get Warehouse List
router.get(
  ROUTES.GET_WAREHOUSE_LIST,
  [jwtMiddleware, validator.get(warehouse_list_schema)],
  get_warehouse_list,
);

// Get Warehouse Details
router.get(
  ROUTES.GET_WAREHOUSE_DETAILS + "/:oid",
  [jwtMiddleware],
  get_warehouse_details,
);

// Create A New Warehouse
router.post(
  ROUTES.CREATE_WAREHOUSE,
  [jwtMiddleware, validator.post(warehouse_schema)],
  create_warehouse,
);

// Update Warehouse Details
router.post(
  ROUTES.UPDATE_WAREHOUSE_DETAILS,
  [jwtMiddleware, validator.post(warehouse_schema)],
  update_warehouse_details,
);

// Get Warehouse List for dropdown
router.get(
  ROUTES.GET_WAREHOUSE_LIST_FOR_DROPDOWN,
  [jwtMiddleware],
  get_warehouse_list_for_dropdown,
);

// Generate Inventory Report by Warehouse
router.post(
  ROUTES.GENERATE_INVENTORY_REPORT_BY_WAREHOUSE,
  [jwtMiddleware],
  generate_inventory_report_by_warehouse,
);

// Generate Product List Report by Warehouse
router.post(
  ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_WAREHOUSE,
  [jwtMiddleware],
  generate_product_list_report_by_warehouse,
);

module.exports = { warehouseRouter: router };
