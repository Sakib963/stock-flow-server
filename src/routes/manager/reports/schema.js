const Joi = require("joi");

const current_stock_report_schema = Joi.object({
      warehouse_oid: Joi.string().allow(null, '').optional(),
      category_oid: Joi.string().allow(null, '').optional(),
      sub_category_oid: Joi.string().allow(null, '').optional(),
});

const product_wise_stock_report_schema = Joi.object({
      product_oid: Joi.string().allow(null, '').optional(),
});


module.exports = { current_stock_report_schema, product_wise_stock_report_schema };