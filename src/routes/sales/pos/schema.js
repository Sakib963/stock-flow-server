const Joi = require("joi");
const { joi_phone } = require("../utils/phone");

const pos_product_list_schema = Joi.object({
    search_text: Joi.string().trim().max(100).allow(null, "").optional(),
});

// Only what the cashier chose. Price, product and name come from the batch on the server (sales REQ-17).
const cart_line = Joi.object({
    inventory_oid: Joi.string().trim().max(128).required(),
    quantity: Joi.number().integer().min(1).max(9999).required(),
    discount: Joi.number().integer().min(0).default(0),
});

const cart_lines = Joi.array().items(cart_line).min(1).unique("inventory_oid").required().messages({ "array.unique": "A batch is in the cart twice. Change the quantity on one line instead." });

const optional_text = (max) => Joi.string().trim().max(max).allow(null, "").empty("").default(null);

// A new phone needs a name (REQ-20); a known one brings its own, so the name is optional here.
const pos_checkout_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    customer: Joi.object({
        phone: Joi.string().trim().max(32).custom(joi_phone).required(),
        name: optional_text(255),
    }).optional(),
    payment_method: Joi.string().valid("cash", "bkash", "nagad", "card", "other").required(),
    payment_reference: optional_text(64),
    payment_status: Joi.string().valid("paid", "partially_paid", "unpaid").required(),
    amount_paid: Joi.when("payment_status", { is: "partially_paid", then: Joi.number().integer().min(1).required(), otherwise: Joi.forbidden() }),
    // The total the cashier confirmed. The server prices the cart itself and refuses when they differ.
    total_amount: Joi.number().integer().min(0).required(),
    notes: optional_text(256),
    lines: cart_lines,
});

const pos_park_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    draft_label: optional_text(64),
    customer_name: optional_text(255),
    customer_phone: Joi.string().trim().max(32).allow(null, "").empty("").default(null).custom(joi_phone),
    notes: optional_text(256),
    lines: cart_lines,
});

const parked_cart_list_schema = Joi.object({});

const parked_cart_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

module.exports = { pos_product_list_schema, pos_checkout_schema, pos_park_schema, parked_cart_list_schema, parked_cart_oid_schema };
