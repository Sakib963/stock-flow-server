const Joi = require("joi");

// Saved without spaces or dashes, so "01711 000111" and "01711-000111" are the same number to the
// unique index on login.mobile_number. Users and a person's own profile both write it.
const mobile_number_rule = Joi.string()
    .trim()
    .pattern(/^\+?[0-9][0-9 -]{5,19}$/)
    .custom((value) => value.replace(/[ -]/g, ""))
    .messages({ "string.pattern.base": "Enter a mobile number of digits, for example 01711000111." });

module.exports = { mobile_number_rule };
