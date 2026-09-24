const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const { validator } = require("../../../middleware/validator");
const { send_for_delivery_schema } = require("./schema");
const send_for_delivery = require("./controller/send-for-delivery");

const router = Router();

router.post(ROUTES.SEND_FOR_DELIVERY, [jwtMiddleware, validator.post(send_for_delivery_schema)], send_for_delivery);

module.exports = { deliveryRouter: router };
