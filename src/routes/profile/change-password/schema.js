const Joi = require("joi");
const { password_rule } = require("../../../utils/password-rule");

// `current_password` stays permissive on purpose: it is checked against the stored hash, not
// against today's rule, so an account created before the rule tightened must still be able to
// prove itself in order to change to a compliant password. Only the new password is held to it.
const change_password_schema = Joi.object({
      current_password: Joi.string().min(1).max(100).required(),
      new_password: password_rule,
      confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
});

const verify_otp_for_password_change_schema = Joi.object({
      otp: Joi.string().length(6).required(),
      otp_oid: Joi.string().guid({ version: 'uuidv4' }).required(),
      new_password: password_rule,
});

module.exports = { change_password_schema, verify_otp_for_password_change_schema };
