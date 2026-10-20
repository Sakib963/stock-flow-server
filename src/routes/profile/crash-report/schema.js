const Joi = require("joi");

const crash_report_schema = Joi.object({
    page: Joi.string().trim().max(1024).required(),
    message: Joi.string().trim().max(1000).required(),
    stack: Joi.string().max(8000).allow(null, "").empty("").default(null),
    version: Joi.string().trim().max(32).allow(null, "").empty("").default(null),
});

module.exports = { crash_report_schema };
