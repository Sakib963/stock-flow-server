const Joi = require("joi");

// The oid is made by the client, so a payment repeated after a lost answer is recorded once.
const create_partner_payment_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    campaign_partner_oid: Joi.string().uuid().required(),
    amount: Joi.number().integer().min(1).max(999999999999).required(),
    paid_on: Joi.date().iso().raw().required(),
    payment_method: Joi.string().valid("bKash", "Nagad", "Bank", "Cash").required(),
    reference: Joi.string().trim().max(255).allow(null, "").empty("").default(null),
    note: Joi.string().trim().max(500).allow(null, "").empty("").default(null),
});

module.exports = { create_partner_payment_schema };
