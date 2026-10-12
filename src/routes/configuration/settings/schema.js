const Joi = require("joi");
const { PHOTO_FOLDER, is_own_photo } = require("../../../utils/cloudinary-photo");

const optional = (max) => Joi.string().trim().max(max).allow(null, "").empty("").default(null);
// A web address as people type it: "www.shop.com" gets https:// in front rather than being refused.
const link = Joi.string()
    .trim()
    .max(255)
    .allow(null, "")
    .empty("")
    .default(null)
    .custom((value, helpers) => {
        const full = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        try {
            return new URL(full).hostname.includes(".") ? full : helpers.message("Write a web address, for example www.yourshop.com");
        } catch {
            return helpers.message("Write a web address, for example www.yourshop.com");
        }
    });

// The business as its customers see it: on the receipt, the invoice, the label and the tracking
// page. The website and the two pages print in the invoice footer. The rest of the settings row
// (legal name, tax numbers, bank details, the tracker template) is not set from here: nothing the
// new app prints reads it (decided by the user, 2026-10-12).
const update_settings_schema = Joi.object({
    name: Joi.string().trim().min(2).max(128).required(),
    logo_url: Joi.string()
        .trim()
        .max(1000)
        .custom((value, helpers) => (is_own_photo(value, PHOTO_FOLDER.branding) ? value : helpers.error("any.invalid")))
        .allow(null, "")
        .empty("")
        .default(null),
    address: optional(500),
    phone_primary: optional(32),
    phone_secondary: optional(32),
    website: link,
    facebook_url: link,
    instagram_url: link,
});

const get_settings_schema = Joi.object({});

const sign_logo_schema = Joi.object({});

module.exports = { update_settings_schema, get_settings_schema, sign_logo_schema };
