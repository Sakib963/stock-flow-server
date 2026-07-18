const Joi = require("joi");

const product_dispose_list_schema = Joi.object({
  offset: Joi.number().required(),
  limit: Joi.number().required(),
  search_text: Joi.string().trim().allow(null, "").optional(),
  status: Joi.string().trim().allow(null, "").optional(),
});

const product_dispose_schema = Joi.object({
  oid: Joi.string().allow(null),
  disposal_date: Joi.date().required(),
  disposal_method: Joi.string()
    .valid("discard", "return_to_supplier", "donation", "recycle", "destroy")
    .required(),
  notes: Joi.string().allow(null, ""),
  products: Joi.array()
    .min(1)
    .items(
      Joi.object({
        oid: Joi.string().allow(null).optional(),
        product_oid: Joi.string().required(),
        inventory_oid: Joi.string().required(),
        dispose_quantity: Joi.number().min(1).required(),
        reason: Joi.string().required(),
        line_note: Joi.string().allow(null, "").optional(),
        // Display-only / server-recomputed fields accepted but ignored by controllers
        available_quantity: Joi.number().allow(null).optional(),
        cost_price: Joi.number().allow(null).optional(),
      }),
    )
    .required(),
});

const product_dispose_details_schema = Joi.object({
  oid: Joi.string().required(),
});

module.exports = {
  product_dispose_list_schema,
  product_dispose_schema,
  product_dispose_details_schema,
};
