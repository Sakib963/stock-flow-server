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
  selling_price: Joi.number().min(0).required(),
  maximum_discount: Joi.number().min(0).required(),
  ad_run_cost: Joi.number().min(0).optional().allow(null),
  packaging_cost: Joi.number().min(0).optional().allow(null),
  gift_cost: Joi.number().min(0).optional().allow(null),
  content_creation_cost: Joi.number().min(0).optional().allow(null),
  influencer_cost: Joi.number().min(0).optional().allow(null),
  cost_remarks: Joi.string().trim().max(500).optional().allow(null, ""),
});

module.exports = { overview_list_schema, overview_details_schema, update_pricing_schema };
