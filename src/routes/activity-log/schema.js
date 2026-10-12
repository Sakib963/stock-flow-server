const Joi = require("joi");
const { AREAS } = require("./utils/activity-kinds");

// A real calendar day: 2026-02-30 is refused here, not by the database as a 500.
const day = Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .custom((value, helpers) => {
        const date = new Date(`${value}T00:00:00Z`);
        return !isNaN(date) && date.toISOString().slice(0, 10) === value ? value : helpers.error("any.invalid");
    })
    .allow(null, "")
    .empty("")
    .optional();

const filters = {
    date_from: day,
    date_to: day,
    person: Joi.string().trim().max(128).allow(null, "").empty("").optional(),
    area: Joi.string()
        .pattern(new RegExp(`^(${AREAS.join("|")})(,(${AREAS.join("|")}))*$`))
        .allow(null, "")
        .empty("")
        .optional(),
    attention: Joi.string().valid("true", "false").allow(null, "").empty("").optional(),
    search: Joi.string().trim().max(100).allow(null, "").empty("").optional(),
};

const activity_list_schema = Joi.object({
    ...filters,
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(30),
});

const activity_summary_schema = Joi.object(filters);

module.exports = { activity_list_schema, activity_summary_schema };
