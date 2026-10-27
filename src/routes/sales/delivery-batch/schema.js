const Joi = require("joi");

const COURIERS = ["Pathao", "Steadfast", "RedX", "Paperfly", "Sundarban", "OwnRider", "Other"];
const STATUSES = ["Open", "HandedOver", "Delivered", "PartlyDelivered", "NotDelivered", "Cancelled"];
const one_or_more = (values) => Joi.string().pattern(new RegExp(`^(${values.join("|")})(,(${values.join("|")}))*$`)).allow(null, "").optional();
const order_oids = Joi.array().items(Joi.string().uuid()).min(1).max(500).unique().required();

const batch_list_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("created_on", "batch_no", "handed_over_on").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    status: one_or_more(STATUSES),
    courier: one_or_more(COURIERS),
    include: Joi.string().valid("", "stats").optional(),
});

const ready_orders_schema = Joi.object({});

const batch_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

// The oid is made by the client, so a save repeated after a lost answer finds the batch it made.
const create_batch_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    courier: Joi.string().valid(...COURIERS).required(),
    note: Joi.string().trim().max(500).allow(null, "").empty("").default(null),
    order_oids,
});

const batch_orders_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    order_oids,
});

// Changing which orders are in the batch carries the row version its page loaded; delivering does not.
const update_batch_orders_schema = batch_orders_schema.keys({ version: Joi.string().pattern(/^\d+$/).required() });

const cancel_batch_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    note: Joi.string().trim().min(3).max(500).required(),
});

module.exports = { batch_list_schema, ready_orders_schema, batch_oid_schema, create_batch_schema, batch_orders_schema, update_batch_orders_schema, cancel_batch_schema };
