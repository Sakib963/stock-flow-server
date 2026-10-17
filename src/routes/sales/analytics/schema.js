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

const optional_oid = Joi.string().trim().max(128).allow(null, "").empty("").optional();

const sales_analytics_schema = Joi.object({
    date_from: day,
    // Days in ISO form compare as text, so a range that ends before it starts is refused here.
    date_to: day.when("date_from", { is: Joi.exist(), then: Joi.string().custom((value, helpers) => (value >= helpers.state.ancestors[0].date_from ? value : helpers.error("any.invalid"))) }),
    channel: Joi.string().valid("POS", "ONLINE").allow(null, "").empty("").optional(),
    source_oid: optional_oid,
    category_oid: optional_oid,
});

module.exports = { sales_analytics_schema };
