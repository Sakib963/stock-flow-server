const Joi = require("joi");

const charge = Joi.number().integer().min(0).max(100000).required();

// A business in Dhaka charges one amount inside Dhaka and another outside it; one in Chattogram the
// same around Chattogram (sales REQ-39). The home district is what "inside" means.
const delivery_charges_schema = Joi.object({
    home_district_oid: Joi.string().trim().max(128).required().messages({ "any.required": "Pick the district the business sends from." }),
    delivery_charge_inside: charge,
    delivery_charge_outside: charge,
});

// The stages an order passes through, named the way a template is matched to one (sales REQ-91).
const MESSAGE_STAGES = ["Pending", "Confirmed", "Packed", "WithCourier", "Delivered", "Failed", "Cancelled", "ToRefund", "Refunded"];

const message_template_schema = Joi.object({
    oid: Joi.string().uuid().optional(),
    name: Joi.string().trim().min(1).max(128).required(),
    language: Joi.string().valid("en", "bn").required(),
    body: Joi.string().trim().min(1).max(2000).required(),
    order_statuses: Joi.array().items(Joi.string().valid(...MESSAGE_STAGES)).unique().default([]),
    status: Joi.string().valid("Active", "Inactive").default("Active"),
});

const message_templates_schema = Joi.object({});

const message_copied_schema = Joi.object({
    order_oid: Joi.string().uuid().required(),
    template_oid: Joi.string().uuid().required(),
});

module.exports = { delivery_charges_schema, message_templates_schema, message_template_schema, message_copied_schema };
