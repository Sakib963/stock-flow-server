const Joi = require("joi");

const TYPES = ["Person", "Page", "Business"];
const PLATFORMS = ["Facebook", "Instagram", "TikTok", "YouTube", "Other"];
const PAYMENT_METHODS = ["bKash", "Nagad", "Bank", "Cash"];
const one_or_more = (values) => Joi.string().pattern(new RegExp(`^(${values.join("|")})(,(${values.join("|")}))*$`)).allow(null, "").optional();

const partner_list_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("name", "partner_type", "status", "created_on", "last_action_on").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    status: one_or_more(["Active", "Inactive"]),
    partner_type: one_or_more(TYPES),
    include: Joi.string().valid("", "stats").optional(),
});

const partner_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

const partner_fields = {
    name: Joi.string().trim().min(1).max(255).required(),
    partner_type: Joi.string().valid(...TYPES).required(),
    platforms: Joi.array().items(Joi.string().valid(...PLATFORMS)).unique().max(PLATFORMS.length).default([]),
    handle: Joi.string().trim().max(255).allow(null, "").empty("").default(null),
    phone_number: Joi.string().trim().pattern(/^\+?[\d\s-]{6,20}$/).allow(null, "").empty("").default(null),
    payment_method: Joi.string().valid(...PAYMENT_METHODS).allow(null, "").empty("").default(null),
    payment_account: Joi.string().trim().max(255).allow(null, "").empty("").default(null),
    note: Joi.string().trim().max(1000).allow(null, "").empty("").default(null),
    status: Joi.string().valid("Active", "Inactive").required(),
};

const partner_create_schema = Joi.object(partner_fields);

const partner_update_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    ...partner_fields,
});

// `oid` is the partner being edited, so its own name is not reported as taken.
const partner_availability_schema = Joi.object({
    value: Joi.string().trim().min(1).max(255).required(),
    oid: Joi.string().uuid().optional(),
});

module.exports = { partner_list_schema, partner_oid_schema, partner_create_schema, partner_update_schema, partner_availability_schema };
