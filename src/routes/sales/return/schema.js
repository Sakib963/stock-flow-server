const Joi = require("joi");

// not_delivered is written only by the order's Not delivered action, with the courier's sub-reason.
const RETURN_REASONS = ["damaged_on_arrival", "wrong_item", "size_or_fit", "changed_mind", "not_as_described", "entered_by_mistake", "other"];
const CONDITIONS = ["Good", "Damaged"];
const REFUND_METHODS = ["cash", "bkash", "nagad", "card", "other"];

const optional_text = (max) => Joi.string().trim().max(max).allow(null, "").empty("").default(null);
const one_or_more = (values) => Joi.string().pattern(new RegExp(`^(${values.join("|")})(,(${values.join("|")}))*$`)).allow(null, "").optional();
const day = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, "").empty("").optional();

const return_list_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("created_on", "return_no").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    status: one_or_more(["Pending", "Returned", "Cancelled"]),
    channel: one_or_more(["POS", "ONLINE"]),
    reason: one_or_more([...RETURN_REASONS, "not_delivered"]),
    date_from: day,
    date_to: day,
    include: Joi.string().valid("", "stats").optional(),
});

const returns_for_order_schema = Joi.object({
    order_oid: Joi.string().uuid().required(),
});

const create_return_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    order_oid: Joi.string().uuid().required(),
    refund_delivery_charge: Joi.boolean().optional(),
    return_reason: Joi.string()
        .valid(...RETURN_REASONS)
        .required(),
    note: Joi.when("return_reason", { is: "other", then: Joi.string().trim().min(1).max(256).required(), otherwise: optional_text(256) }),
    items: Joi.array()
        .items(
            Joi.object({
                order_item_oid: Joi.string().required(),
                quantity: Joi.number().integer().min(1).required(),
                condition: Joi.string()
                    .valid(...CONDITIONS)
                    .required(),
            })
        )
        .min(1)
        .required(),
});

const confirm_return_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    conditions: Joi.array()
        .items(Joi.object({ oid: Joi.string().required(), condition: Joi.string().valid(...CONDITIONS).required() }))
        .optional(),
    refund_method: Joi.string()
        .valid(...REFUND_METHODS)
        .optional(),
});

const return_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

const cancel_return_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    reason: Joi.string().trim().min(1).max(200).required(),
});

module.exports = { RETURN_REASONS, return_list_schema, returns_for_order_schema, create_return_schema, confirm_return_schema, cancel_return_schema, return_oid_schema };
