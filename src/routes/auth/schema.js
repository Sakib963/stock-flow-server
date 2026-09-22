const Joi = require('joi')
const { password_rule } = require('../../utils/password-rule');

const loginSchema = Joi.object({
      email: Joi.string().max(256).required(),
      password: Joi.string().max(200).required(),
      remember: Joi.boolean().optional(),
      // The session this browser already holds, under the body transport, so signing in ends it.
      refresh_token: Joi.string().max(128).allow(null, '').optional(),
      // The last session this browser held. Deliberately loose: a garbled value left in storage
      // must never stop anyone signing in, and it matches nothing.
      previous_session_id: Joi.string().max(64).allow(null, '').optional()
})

// The token is in the body only under AUTH_REFRESH_TRANSPORT=body. Under the cookie transport the
// body is empty and the controller reads the cookie, so it is optional here in both cases.
const refreshSchema = Joi.object({
      refresh_token: Joi.string().max(128).allow(null, '').optional()
});

const signOutSchema = Joi.object({
      refresh_token: Joi.string().max(128).allow(null, '').optional()
});

const signOutEverywhereSchema = Joi.object({
      keep_current: Joi.boolean().optional()
});

const getSessionsSchema = Joi.object({});

const signOutSessionSchema = Joi.object({
      session_id: Joi.string().guid({ version: 'uuidv4' }).required()
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

// The card takes one address and nothing else. An empty object still refuses unknown keys, so a
// query string someone appends cannot quietly become a parameter later.
const userCardSchema = Joi.object({
      email: Joi.string().email({ tlds: { allow: false } }).max(256).required()
});

module.exports = {
      loginSchema,
      refreshSchema,
      signOutSchema,
      signOutEverywhereSchema,
      getSessionsSchema,
      signOutSessionSchema,
      forgotPasswordSchema,
      resetPasswordSchema,
      userCardSchema
}
