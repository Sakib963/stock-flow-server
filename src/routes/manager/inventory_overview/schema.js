const Joi = require("joi");

const overview_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
});

const overview_details_schema = Joi.object({
      product_oid: Joi.string().required(),
});

module.exports = { overview_list_schema, overview_details_schema };
