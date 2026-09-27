const Joi = require("joi");

const brand_list_schema = Joi.object({
      offset: Joi.number().integer().min(0).default(0),
      limit: Joi.number().integer().min(1).max(100).default(20),
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      sort: Joi.string().valid("name", "status", "created_on", "last_action_on").optional(),
      order: Joi.string().valid("asc", "desc").optional(),
      status: Joi.string().pattern(/^(Active|Inactive)(,(Active|Inactive))*$/).allow(null, "").optional(),
      include: Joi.string().valid("", "stats").optional(),
});

const brand_dropdown_schema = Joi.object({});

const brand_oid_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

const brand_fields = {
      name: Joi.string().trim().min(1).max(255).required(),
      description: Joi.string().trim().max(1000).allow(null, "").empty("").default(null),
      // ISO 3166-1 alpha-2, the same rule the column's CHECK holds.
      origin_country: Joi.string().trim().uppercase().pattern(/^[A-Z]{2}$/).allow(null, "").empty("").default(null),
      status: Joi.string().valid("Active", "Inactive").required(),
};

const brand_create_schema = Joi.object(brand_fields);

const brand_update_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      ...brand_fields,
});

// `oid` is the brand being edited, so its own name is not reported as taken.
const brand_availability_schema = Joi.object({
      value: Joi.string().trim().min(1).max(255).required(),
      oid: Joi.string().uuid().optional(),
});

const brand_details_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

module.exports = { brand_list_schema, brand_dropdown_schema, brand_oid_schema, brand_create_schema, brand_update_schema, brand_details_schema, brand_availability_schema };
