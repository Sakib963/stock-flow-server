const Joi = require("joi");

const STORAGE_TYPES = ["shelf", "rack", "cupboard", "box", "hanger", "showcase", "cold", "other"];

const aisle_list_schema = Joi.object({
      offset: Joi.number().integer().min(0).default(0),
      limit: Joi.number().integer().min(1).max(100).default(20),
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      sort: Joi.string().valid("name", "code", "warehouse_name", "status", "created_on", "last_action_on").optional(),
      order: Joi.string().valid("asc", "desc").optional(),
      status: Joi.string().pattern(/^(Active|Inactive)(,(Active|Inactive))*$/).allow(null, "").optional(),
      warehouse_oid: Joi.string().uuid().allow(null, "").optional(),
      include: Joi.string().valid("", "stats").optional(),
});

const aisle_dropdown_schema = Joi.object({
      warehouse_oid: Joi.string().uuid().optional(),
});

const aisle_oid_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

const aisle_fields = {
      name: Joi.string().trim().min(1).max(255).required(),
      code: Joi.string().trim().uppercase().min(1).max(64).required(),
      warehouse_oid: Joi.string().uuid().required(),
      storage_type: Joi.string().valid(...STORAGE_TYPES).allow(null).default(null),
      capacity_units: Joi.number().integer().min(1).max(100000000).allow(null).default(null),
      special_notes: Joi.string().trim().max(1000).allow(null, "").empty("").default(null),
      status: Joi.string().valid("Active", "Inactive").required(),
};

const aisle_create_schema = Joi.object(aisle_fields);

const aisle_update_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      ...aisle_fields,
});

// A name is unique within its warehouse, so asking about one needs the warehouse; a code is unique
// everywhere. `oid` is the aisle being edited, so its own value is not reported as taken.
const aisle_availability_schema = Joi.object({
      field: Joi.string().valid("name", "code").required(),
      value: Joi.string().trim().min(1).max(255).required(),
      warehouse_oid: Joi.string().uuid().when("field", { is: "name", then: Joi.required(), otherwise: Joi.optional() }),
      oid: Joi.string().uuid().optional(),
});

const aisle_code_generate_schema = Joi.object({
      name: Joi.string().trim().min(1).max(255).required(),
      oid: Joi.string().uuid().optional(),
});

const aisle_details_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

module.exports = { aisle_list_schema, aisle_dropdown_schema, aisle_oid_schema, aisle_create_schema, aisle_update_schema, aisle_availability_schema, aisle_code_generate_schema, aisle_details_schema };
