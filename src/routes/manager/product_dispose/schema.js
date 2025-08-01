const Joi = require("joi");

const product_dispose_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
});

const product_dispose_schema = Joi.object({
      oid: Joi.string().allow(null),
      product_oid: Joi.string().min(2).max(128).required(),
      inventory_oid: Joi.string().min(2).max(128).required(),
      dispose_quantity: Joi.number().required(),
      reason: Joi.string().min(2).max(128).required(),
      notes: Joi.string().optional().allow(null, ""),
});

const product_dispose_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { product_dispose_list_schema, product_dispose_schema, product_dispose_details_schema };