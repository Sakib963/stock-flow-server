const Joi = require('joi')
const { password_rule } = require('../../utils/password-rule');

const loginSchema = Joi.object({
      email: Joi.string().required(),
      password: Joi.string().required()
})

const refreshSchema = Joi.object({
      refresh_token: Joi.string().required()
});

// Optional on purpose: the browser sends its refresh token so both tokens of the session close
// together, and a caller holding only a bearer token still gets that access token closed.
const signOutSchema = Joi.object({
      refresh_token: Joi.string().allow(null, '').optional()
});

const forgotPasswordSchema = Joi.object({
      email: Joi.string().email({ tlds: { allow: false } }).required()
});

const resetPasswordSchema = Joi.object({
      email: Joi.string().email({ tlds: { allow: false } }).required(),
      otp: Joi.string().length(6).pattern(/^[0-9]+$/).required(),
      new_password: password_rule,
      confirm_password: Joi.string().valid(Joi.ref('new_password')).required()
});

module.exports = {
      loginSchema,
      refreshSchema,
      signOutSchema,
      forgotPasswordSchema,
      resetPasswordSchema
}
