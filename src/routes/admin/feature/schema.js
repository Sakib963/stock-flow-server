const Joi = require("joi");

const feature_list_schema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().max(100).allow(null, "").optional(),
    sort: Joi.string().valid("position", "label", "module", "state", "last_action_on").optional(),
    order: Joi.string().valid("asc", "desc").optional(),
    state: Joi.string().pattern(/^(On|Disabled|Hidden)(,(On|Disabled|Hidden))*$/).allow(null, "").optional(),
    kind: Joi.string().pattern(/^(Module|Feature)(,(Module|Feature))*$/).allow(null, "").optional(),
    include: Joi.string().valid("", "stats").optional(),
});

// The tree takes nothing; an empty object still refuses unknown keys.
const feature_tree_schema = Joi.object({});

const feature_oid_schema = Joi.object({
    oid: Joi.string().uuid().required(),
});

// Bounded to the menu_item columns, so an over-long label is a 400 naming the field, not a 500.
const optional_text = (max) => Joi.string().trim().max(max).allow(null, "").empty("").default(null);

const feature_update_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    label: Joi.string().trim().min(1).max(128).required(),
    label_bn: Joi.string().trim().min(1).max(128).required(),
    description_en: optional_text(512),
    description_bn: optional_text(512),
    tags: Joi.array().items(Joi.string().trim().min(1).max(40)).max(20).unique().default([]),
    is_new: Joi.boolean().required(),
});

// Disabled needs the reason people will see, in both languages; On and Hidden clear it.
const feature_switch_schema = Joi.object({
    oid: Joi.string().uuid().required(),
    state: Joi.string().valid("On", "Disabled", "Hidden").required(),
    reason_en: Joi.when("state", { is: "Disabled", then: Joi.string().trim().min(1).max(256).required(), otherwise: Joi.any().strip() }),
    reason_bn: Joi.when("state", { is: "Disabled", then: Joi.string().trim().min(1).max(256).required(), otherwise: Joi.any().strip() }),
});

module.exports = { feature_list_schema, feature_tree_schema, feature_oid_schema, feature_update_schema, feature_switch_schema };
