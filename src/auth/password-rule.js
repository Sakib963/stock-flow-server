const Joi = require("joi");

// One password rule for the whole product, so the three places that set a password cannot drift
// apart again: recovery, signed-in change, and admin user creation.
//
// 8 characters with a letter, a number and a special character. The symbol was left out at first,
// for fear it would push staff to write the password down; the user asked for it on 2026-10-12.
// A password set before then still signs in: only a new password is held to this.
const password_rule = Joi.string()
    .min(8)
    .max(100)
    .pattern(/[A-Za-z]/, "letter")
    .pattern(/[0-9]/, "number")
    .pattern(/[^A-Za-z0-9]/, "symbol")
    .required()
    .messages({
        "string.min": "Password must be at least 8 characters.",
        "string.pattern.name": "Password must include at least one letter, one number and one special character.",
    });

module.exports = { password_rule };
