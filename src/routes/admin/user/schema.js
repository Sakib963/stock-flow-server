const Joi = require("joi");

const user_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
});

const create_user_schema = Joi.object({
      oid: Joi.string().allow(null),
      name: Joi.string().required(),
      email: Joi.string().required(),
      mobile_number: Joi.string().required(),
      role: Joi.string().required(),
      designation: Joi.string().allow(null),
      photo: Joi.string().allow(null),
      password: Joi.string().required(),
      status: Joi.string().required(),
});

const update_user_schema = Joi.object({
      oid: Joi.string().required(),
      name: Joi.string().required(),
      email: Joi.string().required(),
      mobile_number: Joi.string().required(),
      role: Joi.string().required(),
      designation: Joi.string().allow(null),
      photo: Joi.string().allow(null),
      status: Joi.string().required(),
});

const user_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { user_list_schema, create_user_schema, user_details_schema, update_user_schema };
