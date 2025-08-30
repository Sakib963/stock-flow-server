const Joi = require("joi");

const get_profile_info_schema = Joi.object({
      user_id: Joi.string().guid({ version: 'uuidv4' }).required()
});

const update_profile_info_schema = Joi.object({
      user_id: Joi.string().guid({ version: 'uuidv4' }).required(),
      email: Joi.string().email().required(),
      name: Joi.string().min(2).max(100).required(),
      age: Joi.number().min(0).optional()
});

module.exports = { get_profile_info_schema, update_profile_info_schema };
