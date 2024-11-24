const Joi = require('joi')

const loginSchema = Joi.object({
      email: Joi.string().required(),
      password: Joi.string().required()
})

const refreshSchema = Joi.object({
      refresh_token: Joi.string().required()
});

module.exports = {
      loginSchema,
      refreshSchema
}  
