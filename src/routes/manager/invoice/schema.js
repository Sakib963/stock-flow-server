const Joi = require("joi");

const invoice_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      status: Joi.string().trim().allow(null, "").optional(),
      selected_date: Joi.string().trim().allow(null, "").optional(),
      search_text: Joi.string().trim().allow(null, "").optional(),
});

const invoice_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { invoice_list_schema };
