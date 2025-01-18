const Joi = require("joi");

const supplier_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
});

const supplier_schema = Joi.object({
      oid: Joi.string().allow(null),
      name: Joi.string().required(),
      contact_person: Joi.string().allow(null),
      email: Joi.string().required(),
      phone_number: Joi.string().required(),
      address: Joi.string().allow(null),
      status: Joi.string().required(),
});

const supplier_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { supplier_list_schema, supplier_schema, supplier_details_schema };
