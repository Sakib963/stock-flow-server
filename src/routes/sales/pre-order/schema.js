const Joi = require("joi");

const pre_order_list_schema = Joi.object({
    offset: Joi.number().required(),
    limit: Joi.number().required(),
    search_text: Joi.string().trim().allow(null, "").optional(),
    status: Joi.string().trim().allow(null, "").optional(),
    date_from: Joi.string().trim().allow(null, "").optional(),
    date_to: Joi.string().trim().allow(null, "").optional(),
});

// A pre-order line references a PRODUCT, never a batch. There is deliberately no
// inventory_oid here -- accepting one would defeat the whole separation.
const pre_order_line_item = Joi.object({
    oid: Joi.string().allow(null, "").optional(),
    product_oid: Joi.string().required(),
    product_name: Joi.string().required(),
    quantity: Joi.number().min(1).required(),
    unit_price: Joi.number().min(0).required(),
    discount: Joi.number().min(0).allow(null).optional(),
    total: Joi.number().min(0).required(),
});

const pre_order_schema = Joi.object({
    oid: Joi.string().allow(null, "").optional(),
    preorder_no: Joi.string().allow(null, "").optional(),
    customer_name: Joi.string().required(),
    customer_phone: Joi.string().required(),
    customer_email: Joi.string().allow(null, "").optional(),
    // Optional at booking, required at conversion (FR-5).
    customer_address: Joi.string().allow(null, "").optional(),
    delivery_city: Joi.string().allow(null, "").optional(),
    delivery_zone: Joi.string().allow(null, "").optional(),
    delivery_area: Joi.string().allow(null, "").optional(),
    delivery_postcode: Joi.string().allow(null, "").optional(),
    discount_total: Joi.number().min(0).allow(null).optional(),
    delivery_charge: Joi.number().min(0).allow(null).optional(),
    advance_paid: Joi.number().min(0).allow(null).optional(),
    advance_method: Joi.string().valid("cash", "bkash", "nagad", "card", "other").allow(null, "").optional(),
    advance_reference: Joi.string().allow(null, "").optional(),
    expected_date: Joi.string().allow(null, "").optional(),
    notes: Joi.string().allow(null, "").optional(),
    products: Joi.array().items(pre_order_line_item).min(1).required(),
});

const pre_order_details_schema = Joi.object({
    oid: Joi.string().required(),
});

const confirm_pre_order_schema = Joi.object({
    oid: Joi.string().required(),
    reason: Joi.string().allow(null, "").optional(),
});

const cancel_pre_order_schema = Joi.object({
    oid: Joi.string().required(),
    reason: Joi.string().trim().required(),
    // Refund is money movement on a cancelled pre-order, never a status (FR-14).
    advance_refunded: Joi.number().min(0).allow(null).optional(),
});

const record_advance_schema = Joi.object({
    oid: Joi.string().required(),
    advance_paid: Joi.number().min(0).required(),
    advance_method: Joi.string().valid("cash", "bkash", "nagad", "card", "other").allow(null, "").optional(),
    advance_reference: Joi.string().allow(null, "").optional(),
});

const mark_converted_schema = Joi.object({
    oid: Joi.string().required(),
    order_oid: Joi.string().required(),
});

const product_list_schema = Joi.object({
    search_text: Joi.string().trim().allow(null, "").optional(),
});

const batches_for_product_schema = Joi.object({
    product_oid: Joi.string().required(),
});

module.exports = {
    pre_order_list_schema,
    pre_order_schema,
    pre_order_details_schema,
    confirm_pre_order_schema,
    cancel_pre_order_schema,
    record_advance_schema,
    mark_converted_schema,
    product_list_schema,
    batches_for_product_schema,
};
