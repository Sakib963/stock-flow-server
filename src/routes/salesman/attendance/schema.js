const Joi = require("joi");

const attendance_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      month: Joi.string().trim().allow(null, "").optional(),
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

module.exports = { attendance_schema, attendance_list_schema, attendance_status_schema };
