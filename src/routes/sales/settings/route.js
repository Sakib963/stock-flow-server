const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { delivery_charges_schema, message_templates_schema, message_template_schema, message_copied_schema } = require("./schema");
const update_delivery_charges = require("./controller/update-delivery-charges");
const get_message_templates = require("./controller/get-message-templates");
const save_message_template = require("./controller/save-message-template");
const record_message_copied = require("./controller/record-message-copied");

// Read by the settings page and by whoever fills a message on an order.
const MESSAGE_READERS = ["sales.settings.view", "sales.order.view", "sales.order-history.view"];

const router = Router();

router.post(ROUTES.UPDATE_DELIVERY_CHARGES, [jwtMiddleware, requirePermission("sales.settings.edit"), validator.post(delivery_charges_schema)], update_delivery_charges);
router.get(ROUTES.GET_MESSAGE_TEMPLATES, [jwtMiddleware, requirePermission(MESSAGE_READERS), validator.get(message_templates_schema)], get_message_templates);
router.post(ROUTES.SAVE_MESSAGE_TEMPLATE, [jwtMiddleware, requirePermission("sales.settings.edit"), validator.post(message_template_schema)], save_message_template);
router.post(ROUTES.RECORD_MESSAGE_COPIED, [jwtMiddleware, requirePermission(["sales.order.view", "sales.order-history.view"]), validator.post(message_copied_schema)], record_message_copied);

module.exports = { salesSettingsRouter: router };
