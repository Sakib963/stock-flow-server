const Joi = require("joi");

const warehouse_list_schema = Joi.object({
      offset: Joi.number().integer().min(0).default(0),
      limit: Joi.number().integer().min(1).max(100).default(20),
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      sort: Joi.string().valid("name", "code", "status", "created_on", "last_action_on").optional(),
      order: Joi.string().valid("asc", "desc").optional(),
      status: Joi.string().pattern(/^(Active|Inactive)(,(Active|Inactive))*$/).allow(null, "").optional(),
      include: Joi.string().valid("", "stats").optional(),
});

const warehouse_dropdown_schema = Joi.object({});

const warehouse_oid_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

const warehouse_fields = {
      name: Joi.string().trim().min(1).max(255).required(),
      code: Joi.string().trim().uppercase().min(1).max(64).required(),
      location: Joi.string().trim().max(1000).allow(null, "").empty("").default(null),
      capacity_units: Joi.number().integer().min(1).max(100000000).allow(null).default(null),
      status: Joi.string().valid("Active", "Inactive").required(),
};

const warehouse_create_schema = Joi.object(warehouse_fields);

const warehouse_update_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      ...warehouse_fields,
});

// `oid` is the warehouse being edited, so its own name or code is not reported as taken.
const warehouse_availability_schema = Joi.object({
      field: Joi.string().valid("name", "code").required(),
      value: Joi.string().trim().min(1).max(255).required(),
      oid: Joi.string().uuid().optional(),
});

const warehouse_code_generate_schema = Joi.object({
      name: Joi.string().trim().min(1).max(255).required(),
      oid: Joi.string().uuid().optional(),
});

const warehouse_details_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

module.exports = { warehouse_list_schema, warehouse_dropdown_schema, warehouse_oid_schema, warehouse_create_schema, warehouse_update_schema, warehouse_availability_schema, warehouse_code_generate_schema, warehouse_details_schema };
