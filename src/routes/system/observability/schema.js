const Joi = require("joi");
const { STATUS_CLASS } = require("./utils/request-where");

const MAX_DAYS = 31;

const day = Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .custom((value, helpers) => {
        const date = new Date(`${value}T00:00:00Z`);
        return !isNaN(date) && date.toISOString().slice(0, 10) === value ? value : helpers.error("any.invalid");
    });

// A range is required and bounded, so no query scans the whole log as it grows.
const range = Joi.object({ date_from: day.required(), date_to: day.required() }).custom((value, helpers) => {
    const days = (Date.parse(value.date_to) - Date.parse(value.date_from)) / 86_400_000;
    return days < 0 || days >= MAX_DAYS ? helpers.message(`Pick a range of at most ${MAX_DAYS} days.`) : value;
});

const text = (max) => Joi.string().trim().max(max).allow(null, "").empty("").optional();

const request_list_schema = range.keys({
    person: text(256),
    ip: text(64),
    country: text(8),
    route: text(255),
    request_id: text(128),
    status: Joi.string()
        .valid(...Object.keys(STATUS_CLASS))
        .allow(null, "")
        .empty("")
        .optional(),
    search: text(100),
    sort: text(64),
    order: Joi.string().valid("asc", "desc").allow(null, "").empty("").optional(),
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(50),
});

const request_oid_schema = Joi.object({ oid: Joi.string().trim().max(128).required() });

const empty_schema = Joi.object({});

module.exports = { range_schema: range, request_list_schema, request_oid_schema, empty_schema };
