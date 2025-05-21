const Joi = require("joi");

const product_list_schema = Joi.object({
      search_text: Joi.string().trim().allow(null, "").optional(),
});

const attendance_status_schema = Joi.object({
      date: Joi.string().trim().optional()
});

const attendance_schema = Joi.object({
      oid: Joi.string().allow(null),
      attendance_date: Joi.date().required(),
      attendance_time: Joi.date().allow(null),
      attendance_location: Joi.string().allow(null),
      action: Joi.string().required()
});

const aisle_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { product_list_schema };
