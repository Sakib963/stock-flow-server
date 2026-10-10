const Joi = require("joi");
const { joi_phone } = require("../utils/phone");

const optional_text = (max) => Joi.string().trim().max(max).allow(null, "").empty("").default(null);
const one_or_more = (values) => Joi.string().pattern(new RegExp(`^(${values.join("|")})(,(${values.join("|")}))*$`)).allow(null, "").optional();
const day = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, "").empty("").optional();

const giveaway_list_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("created_on", "giveaway_no").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    status: one_or_more(["Draft", "Given", "Cancelled"]),
    date_from: day,
    date_to: day,
    include: Joi.string().valid("", "stats").optional(),
});

const giveaway_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

const create_giveaway_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    recipient_name: Joi.string().trim().min(1).max(255).required(),
    recipient_phone: Joi.string().trim().allow(null, "").empty("").default(null).custom(joi_phone),
    address_line: optional_text(512),
    note: Joi.string().trim().min(1).max(256).required(),
    lines: Joi.array()
        .items(Joi.object({ inventory_oid: Joi.string().uuid().required(), quantity: Joi.number().integer().min(1).max(9999).required() }))
        .min(1)
        .max(50)
        .unique("inventory_oid")
        .required(),
});

const cancel_giveaway_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    reason: Joi.string().trim().min(1).max(256).required(),
});

module.exports = { giveaway_list_schema, giveaway_oid_schema, create_giveaway_schema, cancel_giveaway_schema };
