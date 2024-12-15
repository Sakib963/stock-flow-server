const Joi = require("joi");

const category_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
});

const category_schema = Joi.object({
      oid: Joi.string().allow(null),
      name: Joi.string().required(),
      category_code: Joi.string().required(),
      description: Joi.string().allow(null),
      status: Joi.string().required(),
});

const category_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { category_list_schema, category_schema, category_details_schema };
