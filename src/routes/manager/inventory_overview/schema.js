const Joi = require("joi");

const overview_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
      category_oid: Joi.string().trim().allow(null, "").optional(),
      sub_category_oid: Joi.string().trim().allow(null, "").optional(),
      brand_oid: Joi.string().trim().allow(null, "").optional(),
});

const overview_details_schema = Joi.object({
      product_oid: Joi.string().required(),
});

const update_pricing_schema = Joi.object({
      oid: Joi.string().required(),
      selling_price: Joi.number().required(),
      maximum_discount: Joi.number().required(),
});

module.exports = { overview_list_schema, overview_details_schema, update_pricing_schema };
