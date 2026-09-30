const Joi = require("joi");

const REASONS = ["carried_over", "received", "sold", "dispatched", "returned", "disposed", "dispose_reversed"];

const stock_movement_list_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("created_on", "product_name", "quantity").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    reason: Joi.string()
        .pattern(new RegExp(`^(${REASONS.join("|")})(,(${REASONS.join("|")}))*$`))
        .allow(null, "")
        .optional(),
    product_oid: Joi.string().uuid().allow(null, "").optional(),
    include: Joi.string().valid("", "stats").optional(),
});

module.exports = { stock_movement_list_schema };
