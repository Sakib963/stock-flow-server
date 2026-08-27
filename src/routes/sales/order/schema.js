const Joi = require("joi");

const order_list_schema = Joi.object({
    search_text: Joi.string().trim().allow(null, "").optional(),
    channel: Joi.string().valid("POS", "ONLINE").allow(null, "").optional(),
    status: Joi.string().allow(null, "").optional(),
    date_from: Joi.string().allow(null, "").optional(),
    date_to: Joi.string().allow(null, "").optional(),
    limit: Joi.number().optional(),
    offset: Joi.number().optional(),
});

const order_details_schema = Joi.object({
    oid: Joi.string().required(),
});

const order_action_schema = Joi.object({
    oid: Joi.string().required(),
    reason: Joi.string().allow(null, "").optional(),
    payment_collected: Joi.boolean().optional(),
});

const cancel_order_schema = Joi.object({
    oid: Joi.string().required(),
    reason: Joi.string().required(),
});

const edit_pending_order_schema = Joi.object({
    oid: Joi.string().required(),
    customer: Joi.object({
        name: Joi.string().allow(null, "").optional(),
        phone: Joi.string().allow(null, "").optional(),
        address: Joi.string().allow(null, "").optional(),
        city: Joi.string().allow(null, "").optional(),
        zone: Joi.string().allow(null, "").optional(),
        area: Joi.string().allow(null, "").optional(),
        postcode: Joi.string().allow(null, "").optional(),
    }).optional(),
    payment_status: Joi.string().valid("paid", "partially_paid", "unpaid").optional(),
    amount_paid: Joi.number().min(0).optional(),
    delivery_charge: Joi.number().min(0).optional(),
    discount_total: Joi.number().min(0).optional(),
    note: Joi.string().allow(null, "").optional(),
    products: Joi.array()
        .items(
            Joi.object({
                inventory_oid: Joi.string().allow(null, "").optional(),
                product_oid: Joi.string().required(),
                product_name: Joi.string().required(),
                quantity_available: Joi.number().min(0).optional(),
                quantity: Joi.number().min(1).required(),
                unit_price: Joi.number().min(0).required(),
                discount: Joi.number().min(0).allow(null),
                total: Joi.number().min(0).required(),
            })
        )
        .min(1)
        .required(),
});

module.exports = { order_list_schema, order_details_schema, order_action_schema, cancel_order_schema, edit_pending_order_schema };
