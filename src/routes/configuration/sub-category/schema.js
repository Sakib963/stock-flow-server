const Joi = require("joi");

// The standard list query (list page document, REQ-19), with the parent category as a filter.
const sub_category_list_schema = Joi.object({
      offset: Joi.number().integer().min(0).default(0),
      limit: Joi.number().integer().min(1).max(100).default(20),
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      sort: Joi.string().valid("name", "category_code", "category_name", "status", "created_on", "last_action_on").optional(),
      order: Joi.string().valid("asc", "desc").optional(),
      status: Joi.string().pattern(/^(Active|Inactive)(,(Active|Inactive))*$/).allow(null, "").optional(),
      category_oid: Joi.string().uuid().allow(null, "").optional(),
      include: Joi.string().valid("", "stats").optional(),
});

const sub_category_dropdown_schema = Joi.object({
      category_oid: Joi.string().uuid().optional(),
});

const sub_category_oid_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

// The same bounds as a category, for the same reasons: an over-long value or an invented status is
// a 400 naming the field rather than a 500 from the database. The column holding the sub-category's
// own code is called `category_code`, which is the name the table has always had.
const sub_category_fields = {
      name: Joi.string().trim().min(1).max(255).required(),
      category_code: Joi.string().trim().uppercase().min(1).max(50).required(),
      category_oid: Joi.string().uuid().required(),
      description: Joi.string().trim().max(1000).allow(null, "").empty("").default(null),
      status: Joi.string().valid("Active", "Inactive").required(),
};

const sub_category_create_schema = Joi.object(sub_category_fields);

const sub_category_update_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      ...sub_category_fields,
});

// A name is unique within its parent, so asking about one needs the parent. A code is unique across
// every sub-category and needs nothing else.
const sub_category_availability_schema = Joi.object({
      field: Joi.string().valid("name", "category_code").required(),
      value: Joi.string().trim().min(1).max(255).required(),
      category_oid: Joi.string().uuid().when("field", { is: "name", then: Joi.required(), otherwise: Joi.forbidden() }),
      oid: Joi.string().uuid().optional(),
});

const sub_category_code_generate_schema = Joi.object({
      name: Joi.string().trim().min(1).max(255).required(),
      oid: Joi.string().uuid().optional(),
});

const sub_category_details_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

module.exports = { sub_category_list_schema, sub_category_dropdown_schema, sub_category_oid_schema, sub_category_create_schema, sub_category_update_schema, sub_category_availability_schema, sub_category_code_generate_schema, sub_category_details_schema };
