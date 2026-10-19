const { Router } = require("express");
const { ROUTES } = require("../../utils/constant");
const jwtMiddleware = require("../../middleware/validate-jwt");
const requirePermission = require("../../middleware/require-permission");
const { validator } = require("../../middleware/validator");
const { dashboard_schema } = require("./schema");
const get_dashboard = require("./controller/get-dashboard");

// Each section inside is decided by the permission of the feature it summarises.
const router = Router();

router.get(ROUTES.GET_DASHBOARD, [jwtMiddleware, requirePermission("dashboard.overview.view"), validator.get(dashboard_schema)], get_dashboard);

module.exports = { dashboardRouter: router };
