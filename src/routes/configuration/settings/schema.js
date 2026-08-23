const Joi = require("joi");

const s = () => Joi.string().allow(null, "").optional();

const update_settings_schema = Joi.object({
    name: s(),
    legal_name: s(),
    logo_url: s(),
    address: s(),
    phone_primary: s(),
    phone_secondary: s(),
    email: s(),
    website: s(),
    bin: s(),
    tin: s(),
    trade_license: s(),
    bank_details: s(),
    bkash_number: s(),
    nagad_number: s(),
    facebook_url: s(),
    instagram_url: s(),
    invoice_footer: s(),
    invoice_logo_url: s(),
    // Key of a tracker design (see stock-flow-tracker/src/templates). Validated as a
    // slug, not an enum: the template list lives in the tracker repo and it falls
    // back to its default for an unknown key.
    tracker_template: Joi.string()
        .pattern(/^[a-z0-9-]{1,32}$/)
        .allow(null, "")
        .optional(),
    default_delivery_charge: Joi.number().min(0).optional(),
    order_system: Joi.string().valid("pos", "online", "both").optional(),
});

module.exports = { update_settings_schema };
