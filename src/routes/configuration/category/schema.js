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
      include: Joi.string().allow("").optional(),
});

// The dropdown takes nothing. An empty object still refuses unknown keys, so a query string
// someone appends cannot quietly become a parameter later.
const category_dropdown_schema = Joi.object({});

const category_oid_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

const category_schema = Joi.object({
      oid: Joi.string().allow(null),
      name: Joi.string().required(),
      category_code: Joi.string().required(),
      description: Joi.string().allow(null, ""),
      status: Joi.string().required(),
});

const category_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { category_list_schema, category_dropdown_schema, category_oid_schema, category_schema, category_details_schema };
