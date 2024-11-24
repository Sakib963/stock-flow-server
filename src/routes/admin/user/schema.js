const Joi = require("joi");

const user_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
});

module.exports = { user_list_schema };
