const Joi = require("joi");

const send_for_delivery_schema = Joi.object({
    oid: Joi.string().allow(null, "").optional(),
    date_from: Joi.string().allow(null, "").optional(),
    date_to: Joi.string().allow(null, "").optional(),
}).or("oid", "date_from", "date_to");

module.exports = { send_for_delivery_schema };
