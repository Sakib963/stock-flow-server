const Joi = require("joi");

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

const DAY_MS = 24 * 60 * 60 * 1000;

// A period ends on or after it starts and covers a year at most (REQ-04), so one report never reads
// years of the shared database.
const period_fields = {
    date_from: day,
    date_to: day.when("date_from", {
        is: Joi.exist(),
        then: Joi.string().custom((value, helpers) => {
            const from = helpers.state.ancestors[0].date_from;
            if (value < from) return helpers.error("any.invalid");
            return (new Date(value) - new Date(from)) / DAY_MS <= 366 ? value : helpers.message("Choose a period of a year or less.");
        }),
    }),
};

// One page of rows on screen; Print asks for up to 5,000 at once (REQ-21, REQ-24).
const page_fields = {
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(5000).default(25),
};

const optional_oid = Joi.string().trim().max(128).allow(null, "").empty("").optional();

module.exports = { period_fields, page_fields, optional_oid };
