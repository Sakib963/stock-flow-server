const Joi = require("joi");

const warehouse_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
});

const warehouse_schema = Joi.object({
      oid: Joi.string().allow(null),
      name: Joi.string().required(),
      code: Joi.string().required(),
      location: Joi.string().allow(null),
      capacity: Joi.string().allow(null),
      status: Joi.string().required(),
});

const warehouse_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { warehouse_list_schema, warehouse_schema, warehouse_details_schema };
