const Joi = require("joi");
const { period_fields, page_fields } = require("../utils/period-schema");
const { MARKETING_REPORTS } = require("./utils/reports");

const marketing_report_schema = Joi.object({
    report: Joi.string()
        .valid(...Object.keys(MARKETING_REPORTS))
        .required(),
    ...period_fields,
    ...page_fields,
    status: Joi.string().valid("Planned", "Live", "Completed", "Cancelled").optional(),
});

module.exports = { marketing_report_schema };
