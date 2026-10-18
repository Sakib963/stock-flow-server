const Joi = require("joi");

const role_list_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("name", "holders", "actions", "status", "last_action_on").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    status: Joi.string().pattern(/^(Active|Inactive)(,(Active|Inactive))*$/).allow(null, "").optional(),
    include: Joi.string().valid("", "stats").optional(),
});

const role_tree_schema = Joi.object({});

const role_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

const codes = Joi.array().items(Joi.string().trim().max(128)).max(500).unique().required();

const create_role_schema = Joi.object({
    name: Joi.string().trim().min(1).max(64).required(),
    description: Joi.string().trim().max(256).allow(null, "").empty("").default(null),
    codes,
});

// `version` is the role's last change as the details returned it: a save against an older one is refused.
const update_role_schema = create_role_schema.keys({
    oid: Joi.string().uuid().required(),
    version: Joi.string().max(40).required(),
});

const switch_role_status_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    status: Joi.string().valid("Active", "Inactive").required(),
});

module.exports = { role_list_schema, role_tree_schema, role_oid_schema, create_role_schema, update_role_schema, switch_role_status_schema };
