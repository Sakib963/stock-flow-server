const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../utils/validate-jwt");
const { validator } = require("../../../utils/validator");
const { order_list_schema, order_details_schema, order_action_schema, cancel_order_schema, create_return_schema, edit_pending_order_schema } = require("./schema");
const get_order_list = require("./controller/get-order-list");
const get_order_details = require("./controller/get-order-details");
const confirm_order = require("./controller/confirm-order");
const cancel_order = require("./controller/cancel-order");
const deliver_order = require("./controller/deliver-order");
const create_return = require("./controller/create-return");
const edit_pending_order = require("./controller/edit-pending-order");

const router = Router();

router.get(ROUTES.GET_ORDER_LIST, [jwtMiddleware, validator.get(order_list_schema)], get_order_list);
router.get(ROUTES.GET_ORDER_DETAILS, [jwtMiddleware, validator.get(order_details_schema)], get_order_details);
router.post(ROUTES.CONFIRM_ONLINE_ORDER, [jwtMiddleware, validator.post(order_action_schema)], confirm_order);
router.post(ROUTES.CANCEL_ONLINE_ORDER, [jwtMiddleware, validator.post(cancel_order_schema)], cancel_order);
router.post(ROUTES.MARK_DELIVERED, [jwtMiddleware, validator.post(order_action_schema)], deliver_order);
router.post(ROUTES.EDIT_PENDING_ORDER, [jwtMiddleware, validator.post(edit_pending_order_schema)], edit_pending_order);
router.post(ROUTES.CREATE_RETURN, [jwtMiddleware, validator.post(create_return_schema)], create_return);

module.exports = { orderRouter: router };
