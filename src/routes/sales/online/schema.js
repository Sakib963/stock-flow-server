const Joi = require("joi");
const { joi_phone } = require("../utils/phone");
const { address_fields } = require("../customer/schema");

const optional_text = (max) => Joi.string().trim().max(max).allow(null, "").empty("").default(null);

const online_order_setup_schema = Joi.object({});

const chat_message_schema = Joi.object({
    text: Joi.string().trim().min(1).max(2000).required(),
});

// Only what the moderator chose. Price, product and name come from the batch on the server, as at
// the counter (sales REQ-17, REQ-37), and the order's discount is the sum of these.
const order_line = Joi.object({
    inventory_oid: Joi.string().trim().max(128).required(),
    quantity: Joi.number().integer().min(1).max(9999).required(),
    discount: Joi.number().integer().min(0).default(0),
});

// A saved address by its oid, or a new one, saved to the customer with the order (REQ-41).
const order_address = Joi.alternatives().try(Joi.object({ oid: Joi.string().uuid().required() }), Joi.object(address_fields));

const create_online_order_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    customer: Joi.object({
        phone: Joi.string().trim().max(32).custom(joi_phone).required(),
        name: optional_text(255),
        gender: Joi.string().valid("Female", "Male").allow(null, "").empty("").default(null),
        age_band: Joi.string().valid("under_18", "18_24", "25_34", "35_44", "45_plus").allow(null, "").empty("").default(null),
    }).required(),
    address: order_address.required(),
    source_oid: Joi.string().uuid().required().messages({ "any.required": "Pick where the order came from." }),
    // COD pays at the door; an advance is part before dispatch; prepaid is all before (REQ-115).
    payment_type: Joi.string().valid("COD", "ADVANCE", "PREPAID").required(),
    payment_method: Joi.when("payment_type", { is: "COD", then: Joi.forbidden(), otherwise: Joi.string().valid("cash", "bkash", "nagad", "card", "other").required() }),
    payment_reference: optional_text(64),
    amount_paid: Joi.when("payment_type", { is: "ADVANCE", then: Joi.number().integer().min(1).required(), otherwise: Joi.forbidden() }),
    delivery_charge: Joi.number().integer().min(0).max(100000).required(),
    // The total the moderator confirmed. The server prices the order itself and refuses when they differ.
    total_amount: Joi.number().integer().min(0).required(),
    blocked_acknowledged: Joi.boolean().default(false),
    notes: optional_text(256),
    lines: Joi.array().items(order_line).min(1).unique("inventory_oid").required().messages({ "array.unique": "A batch is on the order twice. Change the quantity on one line instead." }),
});

// A half-made order (REQ-42): everything optional but its lines, so a chat that pauses keeps its cart.
const online_draft_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    draft_label: optional_text(64),
    customer: Joi.object({
        phone: Joi.string().trim().max(32).allow(null, "").empty("").default(null),
        name: optional_text(255),
    }).default({ phone: null, name: null }),
    address: order_address.optional(),
    source_oid: Joi.string().uuid().allow(null, "").empty("").default(null),
    payment_type: Joi.string().valid("COD", "ADVANCE", "PREPAID").default("COD"),
    delivery_charge: Joi.number().integer().min(0).max(100000).default(0),
    notes: optional_text(256),
    lines: Joi.array().items(order_line).min(1).unique("inventory_oid").required(),
});

const online_drafts_schema = Joi.object({});

const online_draft_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

module.exports = { online_order_setup_schema, chat_message_schema, create_online_order_schema, online_draft_schema, online_drafts_schema, online_draft_oid_schema };
