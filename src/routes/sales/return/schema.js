const Joi = require("joi");

// Reason presets (D9). Free text goes in `note`, which lands in product_return.notes.
const RETURN_REASONS = ["Damaged on arrival", "Wrong item sent", "Size or fit", "Changed mind", "Not as described", "Other"];

const return_list_schema = Joi.object({
    search_text: Joi.string().trim().allow(null, "").optional(),
    status: Joi.string().valid("Pending", "Returned", "Cancelled", "Completed").allow(null, "").optional(),
    channel: Joi.string().valid("POS", "ONLINE").allow(null, "").optional(),
    date_from: Joi.string().allow(null, "").optional(),
    date_to: Joi.string().allow(null, "").optional(),
    limit: Joi.number().optional(),
    offset: Joi.number().optional(),
});

const returns_for_order_schema = Joi.object({
    order_oid: Joi.string().required(),
});

// Creating a return only records intent. Nothing here moves stock, so the payload
// carries no batch: the batch is whatever the order line was sold from.
const create_return_schema = Joi.object({
    order_oid: Joi.string().required(),
    refund_delivery_charge: Joi.boolean().optional(),
    return_reason: Joi.string()
        .valid(...RETURN_REASONS)
        .required(),
    note: Joi.string().allow(null, "").optional(),
    items: Joi.array()
        .items(
            Joi.object({
                order_item_oid: Joi.string().required(),
                quantity: Joi.number().min(1).required(),
                condition: Joi.string().valid("Good", "Damaged").required(),
            })
        )
        .min(1)
        .required(),
});

const return_action_schema = Joi.object({
    oid: Joi.string().required(),
});

const cancel_return_schema = Joi.object({
    oid: Joi.string().required(),
    reason: Joi.string().trim().min(1).required(),
});

module.exports = {
    RETURN_REASONS,
    return_list_schema,
    returns_for_order_schema,
    create_return_schema,
    return_action_schema,
    cancel_return_schema,
};
