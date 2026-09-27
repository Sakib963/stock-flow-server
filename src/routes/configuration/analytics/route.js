const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { configuration_analytics_schema } = require("./schema");
const get_configuration_analytics = require("./controller/get-configuration-analytics");

const router = Router();

router.get(
      ROUTES.GET_CONFIGURATION_ANALYTICS,
      [jwtMiddleware, requirePermission("configuration.analytics.view"), validator.get(configuration_analytics_schema)],
      get_configuration_analytics
);

module.exports = { analyticsRouter: router };
