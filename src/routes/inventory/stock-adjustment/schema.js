const Joi = require("joi");

const STATUSES = ["Draft", "Submitted", "Verified", "Rejected", "Cancelled"];
const REASONS = ["opening_stock", "found", "lost", "theft", "entry_error"];

// Whole taka and whole units, the same as a purchase order: prices fit numeric(8,0).
const price = Joi.number().integer().min(0).max(99999999);
const quantity = Joi.number().integer().min(1).max(9999);

const optional = (schema) => schema.allow(null, "").empty("").default(null);
const draftOr = (draft, full) => Joi.when("/draft", { is: true, then: draft, otherwise: full });

const stock_adjustment_list_schema = Joi.object({
      offset: Joi.number().integer().min(0).default(0),
      limit: Joi.number().integer().min(1).max(100).default(20),
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      sort: Joi.string().valid("adjustment_number", "reason", "status", "created_on").optional(),
      order: Joi.string().valid("asc", "desc").optional(),
      status: Joi.string().pattern(new RegExp(`^(${STATUSES.join("|")})(,(${STATUSES.join("|")}))*$`)).allow(null, "").optional(),
      reason: Joi.string().pattern(new RegExp(`^(${REASONS.join("|")})(,(${REASONS.join("|")}))*$`)).allow(null, "").optional(),
      include: Joi.string().valid("", "stats").optional(),
});

const stock_adjustment_oid_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

const adjustment_product_picker_schema = Joi.object({
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      limit: Joi.number().integer().min(1).max(50).default(20),
});

// A line either moves an existing batch (inventory_oid) or, going in, creates a new one from the
// fields below it. A Draft line needs only its product; submitting checks the rest against the reason.
const line = Joi.object({
      product_oid: Joi.string().uuid().required(),
      direction: optional(Joi.string().valid("in", "out")),
      quantity: draftOr(optional(quantity), quantity.required()),
      inventory_oid: optional(Joi.string().uuid()),
      cost_price: optional(price),
      intended_use: optional(Joi.string().valid("for_sale", "internal_use")),
      selling_price: optional(price),
      maximum_discount: optional(price),
      warehouse_oid: optional(Joi.string().uuid()),
      aisle_oid: optional(Joi.string().uuid()),
      expiry_date: optional(Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)),
      ad_run_cost: optional(price),
      packaging_cost: optional(price),
      gift_cost: optional(price),
      content_creation_cost: optional(price),
      influencer_cost: optional(price),
      cost_remarks: optional(Joi.string().trim().max(500)),
});

const adjustment_fields = {
      draft: Joi.boolean().default(false),
      reason: Joi.string()
            .valid(...REASONS)
            .required(),
      note: optional(Joi.string().trim().max(1000)),
      lines: draftOr(Joi.array().max(200).items(line).default([]), Joi.array().min(1).max(200).items(line).required()),
};

const stock_adjustment_create_schema = Joi.object(adjustment_fields);

const stock_adjustment_update_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      ...adjustment_fields,
});

// Reject and cancel both say why, so the record explains itself a year later.
const stock_adjustment_reason_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      reason: Joi.string().trim().min(3).max(500).required(),
});

module.exports = {
      REASONS,
      stock_adjustment_list_schema,
      stock_adjustment_oid_schema,
      adjustment_product_picker_schema,
      stock_adjustment_create_schema,
      stock_adjustment_update_schema,
      stock_adjustment_reason_schema,
};
