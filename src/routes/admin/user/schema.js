const Joi = require("joi");
const { mobile_number_rule } = require("../../../utils/mobile-number");
const { PHOTO_FOLDER, is_own_photo } = require("../../../utils/cloudinary-photo");
const { password_rule } = require("../../../auth/password-rule");

const STATUSES = "(Active|Inactive|Deleted)";

const user_list_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("name", "role", "status", "last_sign_in_on").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    status: Joi.string().pattern(new RegExp(`^${STATUSES}(,${STATUSES})*$`)).allow(null, "").optional(),
    role: Joi.string().pattern(/^[0-9a-f-]{36}(,[0-9a-f-]{36})*$/i).allow(null, "").optional(),
    include: Joi.string().valid("", "stats").optional(),
});

const user_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

const empty_schema = Joi.object({});

const email = Joi.string().trim().lowercase().email({ tlds: false }).max(256).messages({ "string.email": "Enter an email address such as rahim@example.com." });
const mobile_number = mobile_number_rule;

const check_user_taken_schema = Joi.object({
    email: email.optional(),
    mobile_number: mobile_number.optional(),
    oid: Joi.string().uuid().optional(),
}).or("email", "mobile_number");

const details = {
    name: Joi.string().trim().min(1).max(128).required(),
    mobile_number: mobile_number.required(),
    designation: Joi.string().trim().max(256).allow(null, "").empty("").default(null),
    photo: Joi.string()
        .trim()
        .max(1000)
        .custom((value, helpers) => (is_own_photo(value, PHOTO_FOLDER.people) ? value : helpers.error("any.invalid")))
        .allow(null, "")
        .empty("")
        .default(null),
    role_oid: Joi.string().uuid().required(),
};

const create_user_schema = Joi.object({
    ...details,
    email: email.required(),
    password: password_rule,
});

// Email and password are not editable here: the history names people by email, and a person sets
// their own password.
const update_user_schema = Joi.object({
    ...details,
    oid: Joi.string().uuid().required(),
    version: Joi.string().max(40).required(),
});

const switch_user_status_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    status: Joi.string().valid("Active", "Inactive").required(),
});

module.exports = { user_list_schema, user_oid_schema, empty_schema, check_user_taken_schema, create_user_schema, update_user_schema, switch_user_status_schema };
