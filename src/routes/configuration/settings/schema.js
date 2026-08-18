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
    brand_color: Joi.string()
        .pattern(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
        .allow(null, "")
        .optional(),
    invoice_bg_url: s(),
    default_delivery_charge: Joi.number().min(0).optional(),
    order_system: Joi.string().valid("pos", "online", "both").optional(),
});

module.exports = { update_settings_schema };
