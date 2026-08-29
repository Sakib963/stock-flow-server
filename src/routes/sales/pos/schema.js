const Joi = require("joi");

const pos_product_list_schema = Joi.object({
    search_text: Joi.string().trim().allow(null, "").optional(),
});

const pos_line_item = Joi.object({
    inventory_oid: Joi.string().required(),
    product_name: Joi.string().required(),
    product_oid: Joi.string().required(),
    quantity_available: Joi.number().min(0).allow(null).optional(),
    quantity: Joi.number().min(1).required(),
    unit_price: Joi.number().min(0).required(),
    discount: Joi.number().min(0).allow(null),
    total: Joi.number().min(0).required(),
});

// `oid` is present only when finalizing an existing POS Draft into a real sale.
const pos_checkout_schema = Joi.object({
    oid: Joi.string().allow(null, "").optional(),
    invoice_no: Joi.string().allow(null, "").optional(),
    customer_name: Joi.string().allow(null, "").optional(),
    customer_phone: Joi.string().allow(null, "").optional(),
    customer_address: Joi.string().allow(null, "").optional(),
    customer_email: Joi.string().allow(null, "").optional(),
    payment_method: Joi.string().valid("cash", "bkash", "nagad", "card", "cod", "other").required(),
    payment_reference: Joi.string().allow(null, "").optional(),
    payment_status: Joi.string().valid("paid", "partially_paid", "unpaid").required(),
    // Only consulted when payment_status is partially_paid. On 'paid' the server
    // fills the full total itself, so the cashier never types it twice.
    amount_paid: Joi.number().min(0).optional(),
    notes: Joi.string().allow(null, "").optional(),
    total_amount: Joi.number().min(0).required(),
    products: Joi.array().items(pos_line_item).min(1).required(),
});

// Draft shares the checkout shape; `oid` present -> update an existing draft.
const pos_draft_schema = pos_checkout_schema;

module.exports = { pos_product_list_schema, pos_checkout_schema, pos_draft_schema };
