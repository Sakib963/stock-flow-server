const Joi = require("joi");
const { period_fields, page_fields, optional_oid } = require("../utils/period-schema");
const { STOCK_REPORTS } = require("./utils/reports");

const stock_report_schema = Joi.object({
    report: Joi.string()
        .valid(...Object.keys(STOCK_REPORTS))
        .required(),
    ...period_fields,
    ...page_fields,
    warehouse_oid: optional_oid,
    category_oid: optional_oid,
    supplier_oid: optional_oid,
    within_days: Joi.number().integer().valid(30, 60, 90, 180).optional(),
    // A disposal or adjustment reason, compared with the stored code, so an unknown one matches nothing.
    reason: Joi.string().trim().max(32).allow(null, "").empty("").optional(),
});

module.exports = { stock_report_schema };
