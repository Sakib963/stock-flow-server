const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { warehouse_list_schema, warehouse_dropdown_schema, warehouse_oid_schema, warehouse_create_schema, warehouse_update_schema, warehouse_availability_schema, warehouse_code_generate_schema, warehouse_details_schema } = require("./schema");
const get_warehouse_list = require("./controller/get-warehouse-list");
const get_warehouse_details = require("./controller/get-warehouse-details");
const create_warehouse = require("./controller/create-warehouse");
const update_warehouse_details = require("./controller/update-warehouse-details");
const get_warehouse_list_for_dropdown = require("./controller/get-warehouse-list-for-dropdown");
const check_warehouse_availability = require("./controller/check-warehouse-availability");
const generate_warehouse_code = require("./controller/generate-warehouse-code");
const generate_inventory_report_by_warehouse = require("./controller/generate-inventory-report-by-warehouse");
const generate_product_list_report_by_warehouse = require("./controller/generate-product-list-report-by-warehouse");

const router = Router();

router.get(
      ROUTES.GET_WAREHOUSE_LIST,
      [jwtMiddleware, requirePermission("configuration.warehouse.view"), validator.get(warehouse_list_schema)],
      get_warehouse_list
);

// The picker behind the aisle form as well as the warehouse's own screens.
router.get(
      ROUTES.GET_WAREHOUSE_LIST_FOR_DROPDOWN,
      [jwtMiddleware, requirePermission(["configuration.warehouse.view", "configuration.aisle.view", "inventory.purchase-order.create", "inventory.purchase-order.edit", "inventory.stock-adjustment.create", "inventory.stock-adjustment.edit"]), validator.get(warehouse_dropdown_schema)],
      get_warehouse_list_for_dropdown
);

router.get(
      ROUTES.CHECK_WAREHOUSE_AVAILABILITY,
      [jwtMiddleware, requirePermission("configuration.warehouse.view"), validator.get(warehouse_availability_schema)],
      check_warehouse_availability
);

router.get(
      ROUTES.GENERATE_WAREHOUSE_CODE,
      [jwtMiddleware, requirePermission("configuration.warehouse.view"), validator.get(warehouse_code_generate_schema)],
      generate_warehouse_code
);

router.post(
      ROUTES.CREATE_WAREHOUSE,
      [jwtMiddleware, requirePermission("configuration.warehouse.create"), validator.post(warehouse_create_schema)],
      create_warehouse
);

router.post(
      ROUTES.UPDATE_WAREHOUSE_DETAILS,
      [jwtMiddleware, requirePermission("configuration.warehouse.edit"), validator.post(warehouse_update_schema)],
      update_warehouse_details
);

router.get(
      ROUTES.GET_WAREHOUSE_DETAILS + "/:oid",
      [jwtMiddleware, requirePermission("configuration.warehouse.view"), validator.params(warehouse_oid_schema)],
      get_warehouse_details
);

router.post(
      ROUTES.GENERATE_INVENTORY_REPORT_BY_WAREHOUSE,
      [jwtMiddleware, requirePermission("configuration.warehouse.export"), validator.post(warehouse_details_schema)],
      generate_inventory_report_by_warehouse
);

router.post(
      ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_WAREHOUSE,
      [jwtMiddleware, requirePermission("configuration.warehouse.export"), validator.post(warehouse_details_schema)],
      generate_product_list_report_by_warehouse
);

module.exports = { warehouseRouter: router };
