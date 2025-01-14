const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require('../../../utils/validate-jwt');
const { validator } = require("../../../utils/validator");
const { warehouse_list_schema, warehouse_schema, warehouse_details_schema } = require("./schema");
const get_warehouse_list = require("./controller/get-warehouse-list");
const get_warehouse_list_for_dropdown = require("./controller/get-warehouse-list-for-dropdown");
const create_warehouse = require("./controller/create-warehouse");
const update_warehouse_details = require("./controller/update-supplier-dealer-details");
const get_warehouse_details = require("./controller/get-warehouse-details");

const router = Router();

// Get Warehouse List
router.get(
      ROUTES.GET_WAREHOUSE_LIST,
      [jwtMiddleware, validator.get(warehouse_list_schema)],
      get_warehouse_list
);

// Get Warehouse List for dropdown
router.get(
      ROUTES.GET_WAREHOUSE_LIST_FOR_DROPDOWN,
      [jwtMiddleware],
      get_warehouse_list_for_dropdown
);

// Create A Warehouse
router.post(
      ROUTES.CREATE_WAREHOUSE,
      [jwtMiddleware, validator.post(warehouse_schema)],
      create_warehouse
);

// Update Warehouse
router.post(
      ROUTES.UPDATE_WAREHOUSE_DETAILS,
      [jwtMiddleware, validator.post(warehouse_schema)],
      update_warehouse_details
);

// Get Warehouse Details
router.get(
      ROUTES.GET_WAREHOUSE_DETAILS,
      [jwtMiddleware, validator.get(warehouse_details_schema)],
      get_warehouse_details
);

module.exports = { warehouse_router: router };