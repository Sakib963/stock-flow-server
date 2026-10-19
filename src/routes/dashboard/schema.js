const Joi = require("joi");
const { PERIODS } = require("./utils/period");

const dashboard_schema = Joi.object({
    period: Joi.string()
        .valid(...PERIODS)
        .default("today"),
});

module.exports = { dashboard_schema };
