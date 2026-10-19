const Joi = require("joi");
const { mobile_number_rule } = require("../../../utils/mobile-number");
const { PHOTO_FOLDER, is_own_photo } = require("../../../utils/cloudinary-photo");

const get_profile_info_schema = Joi.object({});

const sign_profile_photo_schema = Joi.object({});

// Email and role are what a person signs in with and may do, so only an admin changes them; the
// rest is the person's own. A photo is only ever one uploaded to our people folder.
const update_profile_info_schema = Joi.object({
    name: Joi.string().trim().min(2).max(128).required(),
    mobile_number: mobile_number_rule.required(),
    designation: Joi.string().trim().max(128).allow(null, "").empty("").default(null),
    photo: Joi.string()
        .trim()
        .max(1000)
        .custom((value, helpers) => (is_own_photo(value, PHOTO_FOLDER.people) ? value : helpers.error("any.invalid")))
        .allow(null, "")
        .empty("")
        .default(null),
});

module.exports = { get_profile_info_schema, sign_profile_photo_schema, update_profile_info_schema };
