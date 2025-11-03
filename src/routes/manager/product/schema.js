const Joi = require("joi");

const product_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
      category_oid: Joi.string().trim().allow(null, "").optional(),
      sub_category_oid: Joi.string().trim().allow(null, "").optional(),
      brand_oid: Joi.string().trim().allow(null, "").optional(),
});

const product_schema = Joi.object({
      oid: Joi.string().allow(null),
      name: Joi.string().required(),
      sku: Joi.string().allow(null),
      category_oid: Joi.string().required(),
      sub_category_oid: Joi.string().required(),
      brand_oid: Joi.string().allow(null),
      unit_type: Joi.string().allow(null),
      product_nature: Joi.string().required(),
      restock_threshold: Joi.number().required(),
      description: Joi.string().allow(null),
      photo: Joi.string().allow(null),
      status: Joi.string().required(),
});

const product_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { product_list_schema, product_schema, product_details_schema };
