const Joi = require("joi");

const change_password_schema = Joi.object({
      current_password: Joi.string().min(6).max(100).required(),
      new_password: Joi.string().min(6).max(100).required(),
      confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
});

const verify_otp_for_password_change_schema = Joi.object({
      otp: Joi.string().length(6).required(),
      otp_oid: Joi.string().guid({ version: 'uuidv4' }).required(),
      new_password: Joi.string().min(6).max(100).required(),
});

module.exports = { change_password_schema, verify_otp_for_password_change_schema };
