const Joi = require("joi");

const get_note_by_id_schema = Joi.object({
      oid: Joi.string().required()
});

const create_note_schema = Joi.object({
      title: Joi.string().required(),
      content: Joi.string().optional().allow(null, "")
});

const update_note_schema = Joi.object({
      oid: Joi.string().required(),
      title: Joi.string().required(),
      content: Joi.string().optional().allow(null, "")
});

module.exports = { get_note_by_id_schema, update_note_schema, create_note_schema };
