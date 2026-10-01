const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const {
      stock_adjustment_list_schema,
      stock_adjustment_oid_schema,
      adjustment_product_picker_schema,
      stock_adjustment_create_schema,
      stock_adjustment_update_schema,
      stock_adjustment_reason_schema,
} = require("./schema");
const get_stock_adjustment_list = require("./controller/get-stock-adjustment-list");
const get_stock_adjustment_details = require("./controller/get-stock-adjustment-details");
const get_product_list_for_adjustment = require("./controller/get-product-list-for-adjustment");
const create_stock_adjustment = require("./controller/create-stock-adjustment");
const update_stock_adjustment = require("./controller/update-stock-adjustment");
const verify_stock_adjustment = require("./controller/verify-stock-adjustment");
const reject_stock_adjustment = require("./controller/reject-stock-adjustment");
const cancel_stock_adjustment = require("./controller/cancel-stock-adjustment");
const generate_stock_adjustment_report = require("./controller/generate-stock-adjustment-report");

const router = Router();

router.get(ROUTES.GET_STOCK_ADJUSTMENT_LIST, [jwtMiddleware, requirePermission("inventory.stock-adjustment.view"), validator.get(stock_adjustment_list_schema)], get_stock_adjustment_list);

router.get(ROUTES.GET_STOCK_ADJUSTMENT_DETAILS + "/:oid", [jwtMiddleware, requirePermission("inventory.stock-adjustment.view"), validator.params(stock_adjustment_oid_schema)], get_stock_adjustment_details);

router.get(
      ROUTES.GET_PRODUCT_LIST_FOR_ADJUSTMENT,
      [jwtMiddleware, requirePermission(["inventory.stock-adjustment.create", "inventory.stock-adjustment.edit"]), validator.get(adjustment_product_picker_schema)],
      get_product_list_for_adjustment
);

router.post(ROUTES.CREATE_STOCK_ADJUSTMENT, [jwtMiddleware, requirePermission("inventory.stock-adjustment.create"), validator.post(stock_adjustment_create_schema)], create_stock_adjustment);

router.post(ROUTES.UPDATE_STOCK_ADJUSTMENT, [jwtMiddleware, requirePermission("inventory.stock-adjustment.edit"), validator.post(stock_adjustment_update_schema)], update_stock_adjustment);

router.post(ROUTES.VERIFY_STOCK_ADJUSTMENT, [jwtMiddleware, requirePermission("inventory.stock-adjustment.approve"), validator.post(stock_adjustment_oid_schema)], verify_stock_adjustment);

router.post(ROUTES.REJECT_STOCK_ADJUSTMENT, [jwtMiddleware, requirePermission("inventory.stock-adjustment.reject"), validator.post(stock_adjustment_reason_schema)], reject_stock_adjustment);

router.post(ROUTES.CANCEL_STOCK_ADJUSTMENT, [jwtMiddleware, requirePermission("inventory.stock-adjustment.cancel"), validator.post(stock_adjustment_reason_schema)], cancel_stock_adjustment);


router.get(ROUTES.GENERATE_STOCK_ADJUSTMENT_REPORT + "/:oid", [jwtMiddleware, requirePermission("inventory.stock-adjustment.export"), validator.params(stock_adjustment_oid_schema)], generate_stock_adjustment_report);

module.exports = { stockAdjustmentRouter: router };
