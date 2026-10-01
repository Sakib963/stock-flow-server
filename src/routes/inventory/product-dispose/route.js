const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { product_dispose_list_schema, product_dispose_oid_schema, dispose_product_picker_schema, product_dispose_create_schema, product_dispose_update_schema, product_dispose_reason_schema } = require("./schema");
const get_product_dispose_list = require("./controller/get-product-dispose-list");
const get_product_dispose_details = require("./controller/get-product-dispose-details");
const get_product_list_for_dispose = require("./controller/get-product-list-for-dispose");
const create_product_dispose = require("./controller/create-product-dispose");
const update_product_dispose = require("./controller/update-product-dispose");
const approve_product_dispose = require("./controller/approve-product-dispose");
const reject_product_dispose = require("./controller/reject-product-dispose");
const cancel_product_dispose = require("./controller/cancel-product-dispose");
const generate_product_dispose_report = require("./controller/generate-product-dispose-report");

const router = Router();

router.get(ROUTES.GET_PRODUCT_DISPOSE_LIST, [jwtMiddleware, requirePermission("inventory.product-dispose.view"), validator.get(product_dispose_list_schema)], get_product_dispose_list);

router.get(ROUTES.GET_PRODUCT_DISPOSE_DETAILS + "/:oid", [jwtMiddleware, requirePermission("inventory.product-dispose.view"), validator.params(product_dispose_oid_schema)], get_product_dispose_details);

router.get(ROUTES.GET_PRODUCT_LIST_FOR_DISPOSE, [jwtMiddleware, requirePermission(["inventory.product-dispose.create", "inventory.product-dispose.edit"]), validator.get(dispose_product_picker_schema)], get_product_list_for_dispose);

router.post(ROUTES.CREATE_PRODUCT_DISPOSE, [jwtMiddleware, requirePermission("inventory.product-dispose.create"), validator.post(product_dispose_create_schema)], create_product_dispose);

router.post(ROUTES.UPDATE_PRODUCT_DISPOSE, [jwtMiddleware, requirePermission("inventory.product-dispose.edit"), validator.post(product_dispose_update_schema)], update_product_dispose);

router.post(ROUTES.APPROVE_PRODUCT_DISPOSE, [jwtMiddleware, requirePermission("inventory.product-dispose.approve"), validator.post(product_dispose_oid_schema)], approve_product_dispose);

router.post(ROUTES.REJECT_PRODUCT_DISPOSE, [jwtMiddleware, requirePermission("inventory.product-dispose.reject"), validator.post(product_dispose_reason_schema)], reject_product_dispose);

router.post(ROUTES.CANCEL_PRODUCT_DISPOSE, [jwtMiddleware, requirePermission("inventory.product-dispose.cancel"), validator.post(product_dispose_reason_schema)], cancel_product_dispose);

router.get(ROUTES.GENERATE_PRODUCT_DISPOSE_REPORT + "/:oid", [jwtMiddleware, requirePermission("inventory.product-dispose.export"), validator.params(product_dispose_oid_schema)], generate_product_dispose_report);

module.exports = { productDisposeRouter: router };
