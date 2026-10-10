const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const { validator } = require("../../../middleware/validator");
const requirePermission = require("../../../middleware/require-permission");
const { return_list_schema, returns_for_order_schema, create_return_schema, confirm_return_schema, cancel_return_schema, return_oid_schema } = require("./schema");
const get_return_list = require("./controller/get-return-list");
const get_return_details = require("./controller/get-return-details");
const get_returns_for_order = require("./controller/get-returns-for-order");
const create_return = require("./controller/create-return");
const confirm_return = require("./controller/confirm-return");
const cancel_return = require("./controller/cancel-return");

const router = Router();

router.get(ROUTES.GET_RETURN_LIST, [jwtMiddleware, requirePermission("sales.return.view"), validator.get(return_list_schema)], get_return_list);
router.get(ROUTES.GET_RETURNS_FOR_ORDER, [jwtMiddleware, requirePermission("sales.return.view"), validator.get(returns_for_order_schema)], get_returns_for_order);
router.get(ROUTES.GET_RETURN_DETAILS + "/:oid", [jwtMiddleware, requirePermission("sales.return.view"), validator.params(return_oid_schema)], get_return_details);
router.post(ROUTES.CREATE_RETURN, [jwtMiddleware, requirePermission("sales.return.create"), validator.post(create_return_schema)], create_return);
router.post(ROUTES.CONFIRM_RETURN, [jwtMiddleware, requirePermission("sales.return.confirm"), validator.post(confirm_return_schema)], confirm_return);
router.post(ROUTES.CANCEL_RETURN, [jwtMiddleware, requirePermission("sales.return.cancel"), validator.post(cancel_return_schema)], cancel_return);

module.exports = { returnRouter: router };
