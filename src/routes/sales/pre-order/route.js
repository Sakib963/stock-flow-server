const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const { validator } = require("../../../middleware/validator");
const requirePermission = require("../../../middleware/require-permission");
const { pre_order_list_schema, by_product_schema, pre_order_oid_schema, pre_order_schema, cancel_pre_order_schema, product_list_schema, customer_phone_schema } = require("./schema");
const get_pre_order_list = require("./controller/get-pre-order-list");
const get_pre_orders_by_product = require("./controller/get-pre-orders-by-product");
const get_pre_order_details = require("./controller/get-pre-order-details");
const create_pre_order = require("./controller/create-pre-order");
const update_pre_order = require("./controller/update-pre-order");
const confirm_pre_order = require("./controller/confirm-pre-order");
const cancel_pre_order = require("./controller/cancel-pre-order");
const record_pre_order_refund = require("./controller/record-pre-order-refund");
const get_product_list_for_pre_order = require("./controller/get-product-list-for-pre-order");
const find_open_bookings = require("./controller/find-open-bookings");
const get_pre_order_for_conversion = require("./controller/get-pre-order-for-conversion");

const router = Router();

router.get(ROUTES.GET_PRE_ORDER_LIST, [jwtMiddleware, requirePermission("sales.pre-order.view"), validator.get(pre_order_list_schema)], get_pre_order_list);
router.get(ROUTES.GET_PRE_ORDERS_BY_PRODUCT, [jwtMiddleware, requirePermission("sales.pre-order.view"), validator.get(by_product_schema)], get_pre_orders_by_product);
router.get(ROUTES.GET_PRE_ORDER_DETAILS + "/:oid", [jwtMiddleware, requirePermission("sales.pre-order.view"), validator.params(pre_order_oid_schema)], get_pre_order_details);
router.post(ROUTES.CREATE_PRE_ORDER, [jwtMiddleware, requirePermission("sales.pre-order.create"), validator.post(pre_order_schema)], create_pre_order);
router.post(ROUTES.UPDATE_PRE_ORDER, [jwtMiddleware, requirePermission("sales.pre-order.edit"), validator.post(pre_order_schema)], update_pre_order);
router.post(ROUTES.CONFIRM_PRE_ORDER, [jwtMiddleware, requirePermission("sales.pre-order.confirm"), validator.post(pre_order_oid_schema)], confirm_pre_order);
router.post(ROUTES.CANCEL_PRE_ORDER, [jwtMiddleware, requirePermission("sales.pre-order.cancel"), validator.post(cancel_pre_order_schema)], cancel_pre_order);
router.post(ROUTES.RECORD_PRE_ORDER_REFUND, [jwtMiddleware, requirePermission("sales.pre-order.cancel"), validator.post(pre_order_oid_schema)], record_pre_order_refund);
router.get(ROUTES.GET_PRODUCT_LIST_FOR_PRE_ORDER, [jwtMiddleware, requirePermission(["sales.pre-order.create", "sales.pre-order.edit"]), validator.get(product_list_schema)], get_product_list_for_pre_order);
// Converting needs both: the booking may be turned into an order, and an online order may be created.
router.get(ROUTES.GET_PRE_ORDER_FOR_CONVERSION + "/:oid", [jwtMiddleware, requirePermission("sales.pre-order.convert"), requirePermission("sales.online.create"), validator.params(pre_order_oid_schema)], get_pre_order_for_conversion);
router.post(ROUTES.FIND_OPEN_BOOKINGS, [jwtMiddleware, requirePermission(["sales.pre-order.create", "sales.pre-order.edit"]), validator.post(customer_phone_schema)], find_open_bookings);

module.exports = { preOrderRouter: router };
