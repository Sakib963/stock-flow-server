const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { delivery_charges_schema } = require("./schema");
const update_delivery_charges = require("./controller/update-delivery-charges");

const router = Router();

router.post(ROUTES.UPDATE_DELIVERY_CHARGES, [jwtMiddleware, requirePermission("sales.settings.edit"), validator.post(delivery_charges_schema)], update_delivery_charges);

module.exports = { salesSettingsRouter: router };
