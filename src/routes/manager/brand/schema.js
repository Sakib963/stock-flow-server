const Joi = require("joi");

const brand_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
});

const brand_schema = Joi.object({
      oid: Joi.string().allow(null),
      name: Joi.string().required(),
      description: Joi.string().allow(null),
      status: Joi.string().required(),
});

const brand_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { brand_list_schema, brand_schema, brand_details_schema };
