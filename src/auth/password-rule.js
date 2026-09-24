const Joi = require("joi");

// One password rule for the whole product, so the three places that set a password cannot drift
// apart again: recovery, signed-in change, and admin user creation.
//
// 8 characters with a letter and a number. Deliberately no symbol requirement: it pushes shop
// staff towards writing the password on a note by the till, which is a worse outcome than a
// slightly weaker string. The old frontend demanded upper, lower, digit and symbol while the
// server accepted six characters of anything, so in practice the strict rule was theatre.
const password_rule = Joi.string()
    .min(8)
    .max(100)
    .pattern(/[A-Za-z]/, "letter")
    .pattern(/[0-9]/, "number")
    .required()
    .messages({
        "string.min": "Password must be at least 8 characters.",
        "string.pattern.name": "Password must include at least one letter and one number.",
    });

module.exports = { password_rule };
