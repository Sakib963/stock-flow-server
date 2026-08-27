const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../utils/validate-jwt");
const { validator } = require("../../../utils/validator");
const { return_list_schema, returns_for_order_schema, create_return_schema, return_action_schema, cancel_return_schema } = require("./schema");

const get_return_list = require("./controller/get-return-list");
const get_return_list_kpis = require("./controller/get-return-list-kpis");
const get_return_details = require("./controller/get-return-details");
const get_returns_for_order = require("./controller/get-returns-for-order");
const create_return = require("./controller/create-return");
const confirm_return = require("./controller/confirm-return");
const cancel_return = require("./controller/cancel-return");
const mark_refunded = require("./controller/mark-refunded");

const router = Router();

// Returns feature. A customer return is always rooted in a realized order, so it
// lives with Sales & Orders rather than Inventory. Stock moves in exactly one
// place: confirm-return.

// --- List & analytics ---
router.get(ROUTES.GET_RETURN_LIST, [jwtMiddleware, validator.get(return_list_schema)], get_return_list);
router.get(ROUTES.GET_RETURN_LIST_KPIS, [jwtMiddleware], get_return_list_kpis);
router.get(ROUTES.GET_RETURNS_FOR_ORDER, [jwtMiddleware, validator.get(returns_for_order_schema)], get_returns_for_order);

// --- Record ---
router.get(ROUTES.GET_RETURN_DETAILS + "/:oid", [jwtMiddleware], get_return_details);
router.post(ROUTES.CREATE_RETURN, [jwtMiddleware, validator.post(create_return_schema)], create_return);

// --- Lifecycle ---
router.post(ROUTES.CONFIRM_RETURN, [jwtMiddleware, validator.post(return_action_schema)], confirm_return);
router.post(ROUTES.CANCEL_RETURN, [jwtMiddleware, validator.post(cancel_return_schema)], cancel_return);
router.post(ROUTES.MARK_RETURN_REFUNDED, [jwtMiddleware, validator.post(return_action_schema)], mark_refunded);

module.exports = { returnRouter: router };
