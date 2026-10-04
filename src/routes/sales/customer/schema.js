const Joi = require("joi");
const { joi_phone } = require("../utils/phone");

const GENDERS = ["Female", "Male"];
const AGE_BANDS = ["under_18", "18_24", "25_34", "35_44", "45_plus"];
const FLAGS = ["None", "Watch", "Blocked"];

// "Not known" is no value at all (sales REQ-63), so a list filter asks for it as `unknown`.
const one_or_more = (values) => Joi.string().pattern(new RegExp(`^(${values.join("|")})(,(${values.join("|")}))*$`)).allow(null, "").optional();
const optional_text = (max) => Joi.string().trim().max(max).allow(null, "").empty("").default(null);

const customer_list_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("name", "phone", "created_on", "last_action_on").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    status: one_or_more(["Active", "Inactive"]),
    flag: one_or_more(FLAGS),
    gender: one_or_more([...GENDERS, "unknown"]),
    age_band: one_or_more([...AGE_BANDS, "unknown"]),
    district: Joi.string().trim().max(2000).allow(null, "").optional(),
    source: Joi.string().trim().max(2000).allow(null, "").optional(),
    include: Joi.string().valid("", "stats").optional(),
});

const customer_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

const customer_phone_schema = Joi.object({
    phone: Joi.string().trim().max(32).custom(joi_phone).required(),
});

const address_fields = {
    label: optional_text(64),
    recipient_name: Joi.string().trim().min(1).max(255).required(),
    recipient_phone: Joi.string().trim().max(32).allow(null, "").empty("").default(null).custom(joi_phone),
    address_line: Joi.string().trim().min(1).max(1000).required(),
    district_oid: Joi.string().trim().max(128).required(),
    thana_oid: Joi.string().trim().max(128).required(),
    area_oid: optional_text(128),
    area_text: optional_text(128),
    postal_code: Joi.string().trim().pattern(/^\d{4}$/).allow(null, "").empty("").default(null),
    is_default: Joi.boolean().default(false),
};

const customer_fields = {
    name: Joi.string().trim().min(1).max(255).required(),
    phone: Joi.string().trim().max(32).custom(joi_phone).required(),
    gender: Joi.string().valid(...GENDERS).allow(null, "").empty("").default(null),
    age_band: Joi.string().valid(...AGE_BANDS).allow(null, "").empty("").default(null),
    first_source_oid: Joi.string().uuid().allow(null, "").empty("").default(null),
    social_handle: optional_text(255),
    note: optional_text(1000),
};

// The first address rides along so a customer taken from a chat is saved in one step.
const customer_create_schema = Joi.object({
    ...customer_fields,
    address: Joi.object(address_fields).optional(),
});

const customer_update_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    ...customer_fields,
    status: Joi.string().valid("Active", "Inactive").required(),
});

const customer_flag_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    flag: Joi.string().valid(...FLAGS).required(),
    reason: Joi.when("flag", { is: "None", then: optional_text(1000), otherwise: Joi.string().trim().min(1).max(1000).required() }),
});

const address_create_schema = Joi.object({
    customer_oid: Joi.string().uuid().required(),
    ...address_fields,
});

const address_update_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    ...address_fields,
});

const address_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

module.exports = { customer_list_schema, customer_oid_schema, customer_phone_schema, customer_create_schema, customer_update_schema, customer_flag_schema, address_create_schema, address_update_schema, address_oid_schema };
