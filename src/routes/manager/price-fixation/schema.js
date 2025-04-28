const Joi = require("joi");

const price_fixation_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
});

const price_fixation_details_schema = Joi.object({
      product_oid: Joi.string().required(),
});

module.exports = { price_fixation_list_schema, price_fixation_details_schema };
