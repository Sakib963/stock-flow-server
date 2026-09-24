const Joi = require("joi");

// The standard list query (list page document, REQ-19). sort is a closed set, so no other column can
// reach ORDER BY; status takes one value or several separated by commas.
const category_list_schema = Joi.object({
      offset: Joi.number().integer().min(0).default(0),
      limit: Joi.number().integer().min(1).max(100).default(20),
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      sort: Joi.string().valid("name", "category_code", "status", "created_on", "last_action_on").optional(),
      order: Joi.string().valid("asc", "desc").optional(),
      status: Joi.string().pattern(/^(Active|Inactive)(,(Active|Inactive))*$/).allow(null, "").optional(),
      include: Joi.string().valid("", "stats").optional(),
});

// The dropdown takes nothing. An empty object still refuses unknown keys, so a query string
// someone appends cannot quietly become a parameter later.
const category_dropdown_schema = Joi.object({});

const category_oid_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

// Bounded to what the columns and the status CHECK constraint accept, so an over-long name or an
// invented status is a 400 naming the field rather than a 500 from the database. `description` is
// a text column with no limit of its own; 1000 is a product decision, long enough for what belongs
// in a category and short enough that the list's description column stays a description.
//
// The code is upper-cased and an empty description becomes null here, so the row holds what the
// unique index compares and what the detail page tests for. The web form already does both; a
// hand-written request is the case this is for, and it used to store `sare` beside `SARE`.
const category_fields = {
      name: Joi.string().trim().min(1).max(255).required(),
      category_code: Joi.string().trim().uppercase().min(1).max(50).required(),
      description: Joi.string().trim().max(1000).allow(null, "").empty("").default(null),
      status: Joi.string().valid("Active", "Inactive").required(),
};

// Create and update are separate, because `oid` is the difference between them. Sharing one schema
// let an update arrive with no oid and reach the database as `WHERE oid = NULL`, answering 404 for
// what is a malformed request, and let a create send an oid that was silently thrown away.
const category_create_schema = Joi.object(category_fields);

const category_update_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      ...category_fields,
});

// Availability is asked one field at a time. `field` is a closed set because the controller uses it
// to pick a column; `oid` is the category being edited, so its own value is not reported as taken.
const category_availability_schema = Joi.object({
      field: Joi.string().valid("name", "category_code").required(),
      value: Joi.string().trim().min(1).max(255).required(),
      oid: Joi.string().uuid().optional(),
});

// `oid` is the category being edited. Without it the generator reports that category's own code
// as taken and offers a near-identical one, silently changing a code already on printed labels.
const category_code_generate_schema = Joi.object({
      name: Joi.string().trim().min(1).max(255).required(),
      oid: Joi.string().uuid().optional(),
});

const category_details_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

module.exports = { category_list_schema, category_dropdown_schema, category_oid_schema, category_create_schema, category_update_schema, category_details_schema, category_availability_schema, category_code_generate_schema };
