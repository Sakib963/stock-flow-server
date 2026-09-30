const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { stock_movement_list_schema } = require("./schema");
const get_stock_movement_list = require("./controller/get-stock-movement-list");

const router = Router();

router.get(ROUTES.GET_STOCK_MOVEMENT_LIST, [jwtMiddleware, requirePermission("inventory.stock-movement.view"), validator.get(stock_movement_list_schema)], get_stock_movement_list);

module.exports = { stockMovementRouter: router };
