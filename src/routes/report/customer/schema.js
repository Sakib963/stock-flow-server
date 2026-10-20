const Joi = require("joi");
const { period_fields, page_fields } = require("../utils/period-schema");
const { CUSTOMER_REPORTS } = require("./utils/reports");

const customer_report_schema = Joi.object({
    report: Joi.string()
        .valid(...Object.keys(CUSTOMER_REPORTS))
        .required(),
    ...period_fields,
    ...page_fields,
    status: Joi.string().valid("Active", "Inactive").optional(),
    gender: Joi.string().valid("Female", "Male").optional(),
    age_band: Joi.string().valid("under_18", "18_24", "25_34", "35_44", "45_plus").optional(),
    quiet_days: Joi.number().integer().valid(60, 90, 180).optional(),
});

module.exports = { customer_report_schema };
