const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { order_list_schema, order_details_schema, confirm_order_schema, cancel_order_schema } = require("../order/schema");
const get_order_list = require("../order/controller/get-order-list");
const get_order_details = require("../order/controller/get-order-details");
const confirm_order = require("../order/controller/confirm-order");
const cancel_order = require("../order/controller/cancel-order");
const { online_sellers, own_orders } = require("../order/utils/order-state");

// Order history: the orders the person placed, with view, confirm and cancel before dispatch. The
// same logic as Orders, held to their own orders by `own_orders` and opened by its own permissions,
// so whoever is granted them gets it, whatever their role (the user, 2026-10-05).
const router = Router();

router.get(ROUTES.GET_ORDER_LIST, [jwtMiddleware, requirePermission("sales.order-history.view"), own_orders, validator.get(order_list_schema)], get_order_list);
router.get(ROUTES.GET_ORDER_DETAILS, [jwtMiddleware, requirePermission("sales.order-history.view"), own_orders, validator.get(order_details_schema)], get_order_details);
router.post(ROUTES.CONFIRM_ORDER, [jwtMiddleware, requirePermission("sales.order-history.confirm"), online_sellers, own_orders, validator.post(confirm_order_schema)], confirm_order);
router.post(ROUTES.CANCEL_ORDER, [jwtMiddleware, requirePermission("sales.order-history.cancel"), online_sellers, own_orders, validator.post(cancel_order_schema)], cancel_order);

module.exports = { orderHistoryRouter: router };
