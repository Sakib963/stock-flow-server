const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../middleware/validate-jwt");
const requirePermission = require("../../../middleware/require-permission");
const { validator } = require("../../../middleware/validator");
const { sales_analytics_schema } = require("./schema");
const get_sales_analytics_overview = require("./controller/get-sales-analytics-overview");
const get_sales_analytics_orders = require("./controller/get-sales-analytics-orders");
const get_sales_analytics_team = require("./controller/get-sales-analytics-team");
const get_sales_analytics_products = require("./controller/get-sales-analytics-products");
const get_sales_analytics_customers = require("./controller/get-sales-analytics-customers");

const router = Router();

router.get(ROUTES.GET_SALES_ANALYTICS_OVERVIEW, [jwtMiddleware, requirePermission("sales.analytics.view"), validator.get(sales_analytics_schema)], get_sales_analytics_overview);

router.get(ROUTES.GET_SALES_ANALYTICS_ORDERS, [jwtMiddleware, requirePermission("sales.analytics.view"), validator.get(sales_analytics_schema)], get_sales_analytics_orders);

router.get(ROUTES.GET_SALES_ANALYTICS_TEAM, [jwtMiddleware, requirePermission("sales.analytics.view"), validator.get(sales_analytics_schema)], get_sales_analytics_team);

router.get(ROUTES.GET_SALES_ANALYTICS_PRODUCTS, [jwtMiddleware, requirePermission("sales.analytics.view"), validator.get(sales_analytics_schema)], get_sales_analytics_products);

router.get(ROUTES.GET_SALES_ANALYTICS_CUSTOMERS, [jwtMiddleware, requirePermission("sales.analytics.view"), validator.get(sales_analytics_schema)], get_sales_analytics_customers);

module.exports = { salesAnalyticsRouter: router };
