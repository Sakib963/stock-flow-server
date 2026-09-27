const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { aisle_list_schema, aisle_dropdown_schema, aisle_oid_schema, aisle_create_schema, aisle_update_schema, aisle_availability_schema, aisle_code_generate_schema, aisle_details_schema } = require("./schema");
const get_aisle_list = require("./controller/get-aisle-list");
const get_aisle_details = require("./controller/get-aisle-details");
const create_aisle = require("./controller/create-aisle");
const update_aisle_details = require("./controller/update-aisle-details");
const get_aisle_list_for_dropdown = require("./controller/get-aisle-list-for-dropdown");
const check_aisle_availability = require("./controller/check-aisle-availability");
const generate_aisle_code = require("./controller/generate-aisle-code");
const generate_inventory_report_by_aisle = require("./controller/generate-inventory-report-by-aisle");
const generate_product_list_report_by_aisle = require("./controller/generate-product-list-report-by-aisle");

const router = Router();

router.get(
      ROUTES.GET_AISLE_LIST,
      [jwtMiddleware, requirePermission("configuration.aisle.view"), validator.get(aisle_list_schema)],
      get_aisle_list
);

router.get(
      ROUTES.GET_AISLE_LIST_FOR_DROPDOWN,
      [jwtMiddleware, requirePermission("configuration.aisle.view"), validator.get(aisle_dropdown_schema)],
      get_aisle_list_for_dropdown
);

router.get(
      ROUTES.CHECK_AISLE_AVAILABILITY,
      [jwtMiddleware, requirePermission("configuration.aisle.view"), validator.get(aisle_availability_schema)],
      check_aisle_availability
);

router.get(
      ROUTES.GENERATE_AISLE_CODE,
      [jwtMiddleware, requirePermission("configuration.aisle.view"), validator.get(aisle_code_generate_schema)],
      generate_aisle_code
);

router.post(
      ROUTES.CREATE_AISLE,
      [jwtMiddleware, requirePermission("configuration.aisle.create"), validator.post(aisle_create_schema)],
      create_aisle
);

router.post(
      ROUTES.UPDATE_AISLE_DETAILS,
      [jwtMiddleware, requirePermission("configuration.aisle.edit"), validator.post(aisle_update_schema)],
      update_aisle_details
);

router.get(
      ROUTES.GET_AISLE_DETAILS + "/:oid",
      [jwtMiddleware, requirePermission("configuration.aisle.view"), validator.params(aisle_oid_schema)],
      get_aisle_details
);

router.post(
      ROUTES.GENERATE_INVENTORY_REPORT_BY_AISLE,
      [jwtMiddleware, requirePermission("configuration.aisle.export"), validator.post(aisle_details_schema)],
      generate_inventory_report_by_aisle
);

router.post(
      ROUTES.GENERATE_PRODUCT_LIST_REPORT_BY_AISLE,
      [jwtMiddleware, requirePermission("configuration.aisle.export"), validator.post(aisle_details_schema)],
      generate_product_list_report_by_aisle
);

module.exports = { aisleRouter: router };
