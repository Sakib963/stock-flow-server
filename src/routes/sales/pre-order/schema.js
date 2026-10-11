const Joi = require("joi");
const { joi_phone } = require("../utils/phone");

const optional_text = (max) => Joi.string().trim().max(max).allow(null, "").empty("").default(null);
const one_or_more = (values) => Joi.string().pattern(new RegExp(`^(${values.join("|")})(,(${values.join("|")}))*$`)).allow(null, "").optional();

const STATUSES = ["Pending", "Confirmed", "Converted", "Cancelled"];
const CANCEL_REASONS = ["changed_mind", "unreachable", "stock_not_coming", "other"];
const ADVANCE_METHODS = ["cash", "bkash", "nagad", "card", "other"];

const pre_order_list_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("created_on", "preorder_no", "expected_date").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    status: one_or_more(STATUSES),
    ready: Joi.string().valid("", "true").optional(),
    overdue: Joi.string().valid("", "true").optional(),
    include: Joi.string().valid("", "stats").optional(),
});

const by_product_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("units", "to_get", "oldest", "product_name").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    include: Joi.string().valid("", "stats").optional(),
});

const pre_order_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

// A line names a product, never a batch (REQ-02). Its price is what the customer was told, roughly:
// the real price is set from the batch at conversion.
const pre_order_line = Joi.object({
    product_oid: Joi.string().trim().max(128).required(),
    quantity: Joi.number().integer().min(1).max(9999).required(),
    unit_price: Joi.number().integer().min(0).max(10000000).required(),
});

const pre_order_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    customer: Joi.object({
        phone: Joi.string().trim().max(32).custom(joi_phone).required(),
        name: optional_text(255),
    }).required(),
    lines: Joi.array().items(pre_order_line).min(1).max(50).unique("product_oid").required().messages({ "array.unique": "A product is on the pre-order twice. Change the quantity on one line instead." }),
    advance_paid: Joi.number().integer().min(0).default(0),
    advance_method: Joi.when("advance_paid", { is: Joi.number().greater(0), then: Joi.string().valid(...ADVANCE_METHODS).required(), otherwise: Joi.valid(null, "").empty("").default(null) }),
    advance_reference: optional_text(64),
    expected_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, "").empty("").default(null),
    notes: optional_text(256),
});

const cancel_pre_order_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    reason: Joi.string().valid(...CANCEL_REASONS).required(),
    note: Joi.when("reason", { is: "other", then: Joi.string().trim().min(1).max(256).required(), otherwise: optional_text(256) }),
    refund_due: Joi.number().integer().min(0).required(),
});

const customer_phone_schema = Joi.object({
    phone: Joi.string().trim().max(32).custom(joi_phone).required(),
});

const product_list_schema = Joi.object({
    search: Joi.string().trim().max(100).allow(null, "").optional(),
});

module.exports = { pre_order_list_schema, by_product_schema, pre_order_oid_schema, pre_order_schema, cancel_pre_order_schema, product_list_schema, customer_phone_schema };
