const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { create_partner_payment_schema } = require("./schema");
const create_partner_payment = require("./controller/create-partner-payment");

const router = Router();

// Payments are read on the campaign and partner pages, for those with marketing.partner-payment.view.
router.post(ROUTES.CREATE_PARTNER_PAYMENT, [jwtMiddleware, requirePermission("marketing.partner-payment.create"), validator.post(create_partner_payment_schema)], create_partner_payment);

module.exports = { partnerPaymentRouter: router };
