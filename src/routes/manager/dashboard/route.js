const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../utils/validate-jwt");
const get_dashboard_data = require("./controllers/get-dashboard-data");

const router = Router();

// Get product List
router.get(
      ROUTES.GET_DASHBOARD_DATA_FOR_MANAGER,
      [jwtMiddleware],
      get_dashboard_data
);

module.exports = { managerDashboardRouter: router };