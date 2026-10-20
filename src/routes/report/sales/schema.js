const Joi = require("joi");
const { period_fields, page_fields, optional_oid } = require("../utils/period-schema");
const { SALES_REPORTS } = require("./utils/reports");

const sales_report_schema = Joi.object({
    report: Joi.string()
        .valid(...Object.keys(SALES_REPORTS))
        .required(),
    ...period_fields,
    ...page_fields,
    channel: Joi.string().valid("POS", "ONLINE").allow(null, "").empty("").optional(),
    category_oid: optional_oid,
});

module.exports = { sales_report_schema };
