const Joi = require("joi");

const smart_fill_schema = Joi.object({
    text: Joi.string().required(),
});

// Customer + structured delivery address (Pathao: city/zone/area, plus postcode).
const customer_schema = Joi.object({
    name: Joi.string().allow(null, "").optional(),
    phone: Joi.string().allow(null, "").optional(),
    address: Joi.string().required(),
    city: Joi.string().allow(null, "").optional(),
    zone: Joi.string().allow(null, "").optional(),
    area: Joi.string().allow(null, "").optional(),
    postcode: Joi.string().allow(null, "").optional(),
    email: Joi.string().allow(null, "").optional(),
    social_handle: Joi.string().allow(null, "").optional(),
    note: Joi.string().allow(null, "").optional(),
}).required();

const online_line_item = Joi.object({
    inventory_oid: Joi.string().required(),
    product_name: Joi.string().required(),
    product_oid: Joi.string().required(),
    quantity_available: Joi.number().min(0).allow(null).optional(),
    quantity: Joi.number().min(1).required(),
    unit_price: Joi.number().min(0).required(),
    discount: Joi.number().min(0).allow(null),
    total: Joi.number().min(0).required(),
});

const create_online_order_schema = Joi.object({
    invoice_no: Joi.string().allow(null, "").optional(),
    customer: customer_schema,
    payment_type: Joi.string().valid("COD", "PREPAID").optional(),
    payment_status: Joi.string().valid("paid", "partially_paid", "unpaid").optional(),
    amount_paid: Joi.number().min(0).optional(),
    delivery_charge: Joi.number().min(0).optional(),
    discount_total: Joi.number().min(0).optional(),
    note: Joi.string().allow(null, "").optional(),
    products: Joi.array().items(online_line_item).min(1).required(),
});

// Draft: everything optional except the product lines (parks the cart without holding stock).
const online_draft_schema = Joi.object({
    oid: Joi.string().allow(null, "").optional(),
    invoice_no: Joi.string().allow(null, "").optional(),
    customer: Joi.object({
        name: Joi.string().allow(null, "").optional(),
        phone: Joi.string().allow(null, "").optional(),
        address: Joi.string().allow(null, "").optional(),
        city: Joi.string().allow(null, "").optional(),
        zone: Joi.string().allow(null, "").optional(),
        area: Joi.string().allow(null, "").optional(),
        postcode: Joi.string().allow(null, "").optional(),
        email: Joi.string().allow(null, "").optional(),
        social_handle: Joi.string().allow(null, "").optional(),
        note: Joi.string().allow(null, "").optional(),
    }).optional(),
    payment_type: Joi.string().valid("COD", "PREPAID").optional(),
    payment_status: Joi.string().valid("paid", "partially_paid", "unpaid").optional(),
    amount_paid: Joi.number().min(0).optional(),
    delivery_charge: Joi.number().min(0).optional(),
    discount_total: Joi.number().min(0).optional(),
    note: Joi.string().allow(null, "").optional(),
    products: Joi.array().items(online_line_item).min(1).required(),
});

const create_preorder_schema = Joi.object({
    invoice_no: Joi.string().allow(null, "").optional(),
    customer: customer_schema,
    payment_type: Joi.string().valid("COD", "PREPAID").optional(),
    payment_status: Joi.string().valid("paid", "partially_paid", "unpaid").optional(),
    delivery_charge: Joi.number().min(0).optional(),
    discount_total: Joi.number().min(0).optional(),
    note: Joi.string().allow(null, "").optional(),
    products: Joi.array()
        .items(
            Joi.object({
                product_oid: Joi.string().required(),
                product_name: Joi.string().required(),
                quantity: Joi.number().min(1).required(),
                unit_price: Joi.number().min(0).required(),
                discount: Joi.number().min(0).allow(null),
                total: Joi.number().min(0).required(),
            })
        )
        .min(1)
        .required(),
});

const convert_preorder_schema = Joi.object({
    oid: Joi.string().required(),
    items: Joi.array()
        .items(Joi.object({ order_item_oid: Joi.string().required(), inventory_oid: Joi.string().required() }))
        .min(1)
        .required(),
});

module.exports = { smart_fill_schema, create_online_order_schema, online_draft_schema, create_preorder_schema, convert_preorder_schema };
