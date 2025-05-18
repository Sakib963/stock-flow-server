const Joi = require("joi");

const attendance_list_schema = Joi.object({
      offset: Joi.number().required(),
      limit: Joi.number().required(),
      month: Joi.string().trim().allow(null, "").optional(),
      search_text: Joi.string().trim().allow(null, "").optional(),
});

const attendance_status_schema = Joi.object({
      date: Joi.string().trim().optional()
});

const attendance_schema = Joi.object({
      oid: Joi.string().allow(null),
      attendance_date: Joi.date().required(),
      sign_in_time: Joi.date().required(),
      sign_in_location: Joi.string().required(),
      sign_out_time: Joi.date().required(),
      sign_out_location: Joi.string().required(),
});



const attendance_details_schema = Joi.object({
      oid: Joi.string().required(),
});

module.exports = { attendance_schema, attendance_list_schema, attendance_status_schema, attendance_details_schema };

