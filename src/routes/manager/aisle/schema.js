const Joi = require("joi");

const aisle_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      search_text: Joi.string().trim().allow(null, "").optional(),
      status: Joi.string().trim().allow(null, "").optional(),
});

const aisle_list_for_dropdown_schema = Joi.object({
      warehouse_oid: Joi.string().required(),
});

const aisle_schema = Joi.object({
      oid: Joi.string().allow(null),
      name: Joi.string().required(),
      code: Joi.string().required(),
      warehouse_oid: Joi.string().required(),
      capacity: Joi.string().allow(null),
      type_of_storage: Joi.string().allow(null),
      special_notes: Joi.string().allow(null),
      status: Joi.string().required(),
});

const aisle_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { aisle_list_schema, aisle_schema, aisle_details_schema, aisle_list_for_dropdown_schema };
