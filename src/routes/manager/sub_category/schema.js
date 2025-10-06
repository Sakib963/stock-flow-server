const Joi = require("joi");

const sub_category_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
});

const sub_category_dropdown_schema = Joi.object({
      category_oid: Joi.string().trim().required()
});

const sub_category_schema = Joi.object({
      oid: Joi.string().allow(null),
      name: Joi.string().required(),
      category_code: Joi.string().required(),
      description: Joi.string().allow(null, ""),
      category_oid: Joi.string().required(),
      status: Joi.string().required(),
});

const sub_category_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { sub_category_list_schema, sub_category_schema, sub_category_details_schema, sub_category_dropdown_schema };
