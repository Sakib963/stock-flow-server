const Joi = require("joi");

const STATUSES = ["Draft", "Submitted", "Approved", "Rejected", "Cancelled"];
const REASONS = ["damaged", "expired", "spoiled", "sample", "quality_reject", "other"];
const METHODS = ["discarded", "destroyed", "donated", "recycled", "other"];

const quantity = Joi.number().integer().min(1).max(9999);
const optional = (schema) => schema.allow(null, "").empty("").default(null);
const draftOr = (draft, full) => Joi.when("/draft", { is: true, then: draft, otherwise: full });

const product_dispose_list_schema = Joi.object({
      offset: Joi.number().integer().min(0).default(0),
      limit: Joi.number().integer().min(1).max(100).default(20),
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      sort: Joi.string().valid("dispose_no", "disposal_date", "status", "created_on").optional(),
      order: Joi.string().valid("asc", "desc").optional(),
      status: Joi.string().pattern(new RegExp(`^(${STATUSES.join("|")})(,(${STATUSES.join("|")}))*$`)).allow(null, "").optional(),
      include: Joi.string().valid("", "stats").optional(),
});

const product_dispose_oid_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

const dispose_product_picker_schema = Joi.object({
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      limit: Joi.number().integer().min(1).max(50).default(20),
});

// A Draft line needs only its product; submitting needs the batch, quantity and reason.
const line = Joi.object({
      product_oid: Joi.string().uuid().required(),
      inventory_oid: draftOr(optional(Joi.string().uuid()), Joi.string().uuid().required()),
      quantity: draftOr(optional(quantity), quantity.required()),
      reason: draftOr(optional(Joi.string().valid(...REASONS)), Joi.string().valid(...REASONS).required()),
      line_note: optional(Joi.string().trim().max(500)),
});

const dispose_fields = {
      draft: Joi.boolean().default(false),
      method: optional(Joi.string().valid(...METHODS)),
      note: optional(Joi.string().trim().max(1000)),
      lines: draftOr(Joi.array().max(200).items(line).default([]), Joi.array().min(1).max(200).items(line).required()),
};

const product_dispose_create_schema = Joi.object(dispose_fields);

const product_dispose_update_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      ...dispose_fields,
});

const product_dispose_reason_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      reason: Joi.string().trim().min(3).max(500).required(),
});

module.exports = { REASONS, METHODS, product_dispose_list_schema, product_dispose_oid_schema, dispose_product_picker_schema, product_dispose_create_schema, product_dispose_update_schema, product_dispose_reason_schema };
