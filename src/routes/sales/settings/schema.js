const Joi = require("joi");

const charge = Joi.number().integer().min(0).max(100000).required();

// A business in Dhaka charges one amount inside Dhaka and another outside it; one in Chattogram the
// same around Chattogram (sales REQ-39). The home district is what "inside" means.
const delivery_charges_schema = Joi.object({
    home_district_oid: Joi.string().trim().max(128).required().messages({ "any.required": "Pick the district the business sends from." }),
    delivery_charge_inside: charge,
    delivery_charge_outside: charge,
});

module.exports = { delivery_charges_schema };
