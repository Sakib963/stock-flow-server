const Joi = require("joi");

const location_search_schema = Joi.object({
    level: Joi.string().valid("District", "Thana").required(),
    search: Joi.string().trim().max(100).allow("").default(""),
    district_oid: Joi.string().trim().max(128).optional(),
    // Every district at once (64) for a picker that filters on the page.
    limit: Joi.number().integer().min(1).max(100).default(20),
});

const location_match_schema = Joi.object({
    text: Joi.string().trim().min(1).max(1000).required(),
});

module.exports = { location_search_schema, location_match_schema };
