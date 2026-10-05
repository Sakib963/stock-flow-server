const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { order_list_schema, order_details_schema, order_oid_schema, confirm_order_schema, cancel_order_schema, dispatch_order_schema, not_delivered_schema } = require("./schema");
const get_order_list = require("./controller/get-order-list");
const get_order_details = require("./controller/get-order-details");
const confirm_order = require("./controller/confirm-order");
const cancel_order = require("./controller/cancel-order");
const mark_order_packed = require("./controller/mark-order-packed");
const dispatch_order = require("./controller/dispatch-order");
const deliver_order = require("./controller/deliver-order");
const mark_order_not_delivered = require("./controller/mark-order-not-delivered");

const router = Router();

router.get(ROUTES.GET_ORDER_LIST, [jwtMiddleware, requirePermission("sales.order.view"), validator.get(order_list_schema)], get_order_list);
router.get(ROUTES.GET_ORDER_DETAILS, [jwtMiddleware, requirePermission("sales.order.view"), validator.get(order_details_schema)], get_order_details);
router.post(ROUTES.CONFIRM_ORDER, [jwtMiddleware, requirePermission("sales.order.confirm"), validator.post(confirm_order_schema)], confirm_order);
router.post(ROUTES.CANCEL_ORDER, [jwtMiddleware, requirePermission("sales.order.cancel"), validator.post(cancel_order_schema)], cancel_order);
router.post(ROUTES.MARK_ORDER_PACKED, [jwtMiddleware, requirePermission("sales.order.dispatch"), validator.post(order_oid_schema)], mark_order_packed);
router.post(ROUTES.DISPATCH_ORDER, [jwtMiddleware, requirePermission("sales.order.dispatch"), validator.post(dispatch_order_schema)], dispatch_order);
router.post(ROUTES.DELIVER_ORDER, [jwtMiddleware, requirePermission("sales.order.deliver"), validator.post(order_oid_schema)], deliver_order);
router.post(ROUTES.MARK_ORDER_NOT_DELIVERED, [jwtMiddleware, requirePermission("sales.order.deliver"), validator.post(not_delivered_schema)], mark_order_not_delivered);

module.exports = { orderRouter: router };
