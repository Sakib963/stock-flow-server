const Joi = require("joi");

const user_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
});

const user_form_schema = Joi.object({
      name: Joi.string().required(),
      email: Joi.string().required(),
      mobile_number: Joi.string().required(),
      role: Joi.string().required(),
      designation: Joi.string().allow(null),
      photo: Joi.string().allow(null),
      password: Joi.string().required(),
      status: Joi.string().required(),
});

module.exports = { user_list_schema, user_form_schema };
