const Joi = require("joi");

const product_return_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      status: Joi.string().trim().allow(null, "").optional(),
      search_text: Joi.string().trim().allow(null, "").optional(),
});

const product_return_schema = Joi.object({
      invoice_oid: Joi.string().required(),
      invoice_no: Joi.string().required(),
      return_reason: Joi.string().allow(null),
      refund_amount: Joi.number().min(0).required(),
      products: Joi.array().items(Joi.object({
            product_oid: Joi.string().required(),
            inventory_oid: Joi.string().required(),
            return_quantity: Joi.number().min(1).required(),
      }).required()).required()
});

const product_return_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { product_return_list_schema, product_return_schema, product_return_details_schema };
