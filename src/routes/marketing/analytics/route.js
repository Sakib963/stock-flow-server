const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { sales_analytics_schema } = require("../../sales/analytics/schema");
const get_marketing_analytics_overview = require("./controller/get-marketing-analytics-overview");
const get_marketing_campaign_results = require("./controller/get-marketing-campaign-results");

const router = Router();

// The same period and channel filter as sales analytics, so the two pages read one period alike.
router.get(ROUTES.GET_MARKETING_ANALYTICS_OVERVIEW, [jwtMiddleware, requirePermission("marketing.analytics.view"), validator.get(sales_analytics_schema)], get_marketing_analytics_overview);
router.get(ROUTES.GET_MARKETING_CAMPAIGN_RESULTS, [jwtMiddleware, requirePermission("marketing.analytics.view"), validator.get(sales_analytics_schema)], get_marketing_campaign_results);

module.exports = { marketingAnalyticsRouter: router };
