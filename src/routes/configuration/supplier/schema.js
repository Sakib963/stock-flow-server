const Joi = require("joi");

const supplier_list_schema = Joi.object({
      offset: Joi.number().integer().min(0).default(0),
      limit: Joi.number().integer().min(1).max(100).default(20),
      search: Joi.string().trim().max(100).allow(null, "").optional(),
      sort: Joi.string().valid("name", "contact_person", "status", "created_on", "last_action_on").optional(),
      order: Joi.string().valid("asc", "desc").optional(),
      status: Joi.string().pattern(/^(Active|Inactive)(,(Active|Inactive))*$/).allow(null, "").optional(),
      include: Joi.string().valid("", "stats").optional(),
});

const supplier_dropdown_schema = Joi.object({});

const supplier_oid_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

// A phone number as people write it: digits with spaces, dashes or a leading +. Uniqueness is on the
// digits alone, in the database.
const phone = Joi.string().trim().pattern(/^\+?[\d\s-]{6,20}$/);

const supplier_fields = {
      name: Joi.string().trim().min(1).max(255).required(),
      contact_person: Joi.string().trim().max(255).allow(null, "").empty("").default(null),
      phone_number: phone.required(),
      whatsapp_number: phone.allow(null, "").empty("").default(null),
      email: Joi.string().trim().lowercase().email({ tlds: false }).max(128).allow(null, "").empty("").default(null),
      address: Joi.string().trim().max(1000).allow(null, "").empty("").default(null),
      payment_details: Joi.string().trim().max(1000).allow(null, "").empty("").default(null),
      status: Joi.string().valid("Active", "Inactive").required(),
};

const supplier_create_schema = Joi.object(supplier_fields);

const supplier_update_schema = Joi.object({
      oid: Joi.string().uuid().required(),
      ...supplier_fields,
});

// `oid` is the supplier being edited, so its own name or phone is not reported as taken.
const supplier_availability_schema = Joi.object({
      field: Joi.string().valid("name", "phone_number").required(),
      value: Joi.string().trim().min(1).max(255).required(),
      oid: Joi.string().uuid().optional(),
});

const supplier_details_schema = Joi.object({
      oid: Joi.string().uuid().required(),
});

module.exports = { supplier_list_schema, supplier_dropdown_schema, supplier_oid_schema, supplier_create_schema, supplier_update_schema, supplier_availability_schema, supplier_details_schema };
