const Joi = require("joi");

const one_or_more = (values) => Joi.string().pattern(new RegExp(`^(${values.join("|")})(,(${values.join("|")}))*$`)).allow(null, "").optional();
const optional_text = (max) => Joi.string().trim().max(max).allow(null, "").empty("").default(null);
const day = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, "").empty("").optional();

const STATUSES = ["Pending", "Confirmed", "Purchased", "Delivered", "PartiallyReturned", "Returned", "Cancelled", "Refunded"];
const DELIVERY = ["Preparing", "Packed", "WithCourier", "Delivered", "Failed", "BackInShop"];
const CONFIRMED_VIA = ["PhoneCall", "Message", "AdvanceReceived", "NotNeeded"];
const CANCEL_REASONS = ["changed_mind", "unreachable", "fake_order", "price", "ordered_elsewhere", "out_of_stock", "duplicate", "cannot_deliver", "other"];
const COURIERS = ["Pathao", "Steadfast", "RedX", "Paperfly", "Sundarban", "OwnRider", "Other"];
const NOT_DELIVERED = ["refused", "unreachable", "wrong_address", "other"];

const order_list_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("created_on", "invoice_no", "total_amount").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    channel: one_or_more(["POS", "ONLINE"]),
    status: one_or_more(STATUSES),
    delivery_status: one_or_more(DELIVERY),
    payment_status: one_or_more(["unpaid", "partially_paid", "paid", "partially_refunded", "refunded"]),
    refund_status: one_or_more(["None", "ToRefund", "Refunded"]),
    date_from: day,
    date_to: day,
    include: Joi.string().valid("", "stats").optional(),
});

const order_details_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

const order_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

const confirm_order_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    confirmed_via: Joi.string().valid(...CONFIRMED_VIA).required(),
    note: optional_text(256),
});

const cancel_order_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    reason_code: Joi.string().valid(...CANCEL_REASONS).required(),
    note: Joi.when("reason_code", { is: "other", then: Joi.string().trim().min(1).max(256).required(), otherwise: optional_text(256) }),
});

const dispatch_order_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    courier: Joi.string().valid(...COURIERS).required(),
    consignment_no: optional_text(128),
});

const not_delivered_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    reason: Joi.string().valid(...NOT_DELIVERED).required(),
    note: Joi.when("reason", { is: "other", then: Joi.string().trim().min(1).max(256).required(), otherwise: optional_text(256) }),
});

const record_refund_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    amount: Joi.number().integer().min(1).required(),
    method: Joi.string().valid("cash", "bkash", "nagad", "card", "other").required(),
    note: Joi.when("method", { is: "other", then: Joi.string().trim().min(1).max(256).required(), otherwise: optional_text(256) }),
});

module.exports = { order_list_schema, order_details_schema, order_oid_schema, confirm_order_schema, cancel_order_schema, dispatch_order_schema, not_delivered_schema, record_refund_schema };
