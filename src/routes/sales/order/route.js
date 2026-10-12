const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { order_list_schema, order_details_schema, confirm_order_schema, cancel_order_schema, not_delivered_schema, record_refund_schema } = require("./schema");
const get_order_list = require("./controller/get-order-list");
const get_order_details = require("./controller/get-order-details");
const confirm_order = require("./controller/confirm-order");
const cancel_order = require("./controller/cancel-order");
const mark_order_not_delivered = require("./controller/mark-order-not-delivered");
const record_order_refund = require("./controller/record-order-refund");
const { online_sellers } = require("./utils/order-state");

const router = Router();

router.get(ROUTES.GET_ORDER_LIST, [jwtMiddleware, requirePermission("sales.order.view"), validator.get(order_list_schema)], get_order_list);
router.get(ROUTES.GET_ORDER_DETAILS, [jwtMiddleware, requirePermission("sales.order.view"), validator.get(order_details_schema)], get_order_details);
router.post(ROUTES.CONFIRM_ORDER, [jwtMiddleware, requirePermission("sales.order.confirm"), online_sellers, validator.post(confirm_order_schema)], confirm_order);
router.post(ROUTES.CANCEL_ORDER, [jwtMiddleware, requirePermission("sales.order.cancel"), online_sellers, validator.post(cancel_order_schema)], cancel_order);
router.post(ROUTES.MARK_ORDER_NOT_DELIVERED, [jwtMiddleware, requirePermission("sales.order.deliver"), online_sellers, validator.post(not_delivered_schema)], mark_order_not_delivered);
router.post(ROUTES.RECORD_ORDER_REFUND, [jwtMiddleware, requirePermission("sales.order.refund"), online_sellers, validator.post(record_refund_schema)], record_order_refund);

module.exports = { orderRouter: router };
