const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const jwtMiddleware = require("../../../utils/validate-jwt");
const get_analytics_metrics = require("./controller/get-analytics-metrics");
const get_stock_trend = require("./controller/get-stock-trend");
const get_inventory_value_trend = require("./controller/get-inventory-value-trend");
const get_top_products = require("./controller/get-top-products");
const get_product_performance = require("./controller/get-product-performance");
const get_stock_movements = require("./controller/get-stock-movements");
const export_analytics_report = require("./controller/export-analytics-report");

const router = Router();

// POST endpoints (using POST to send filter payload in body)
router.post(
  ROUTES.GET_ANALYTICS_METRICS,
  [jwtMiddleware],
  get_analytics_metrics,
);
router.post(ROUTES.GET_STOCK_TREND, [jwtMiddleware], get_stock_trend);
router.post(
  ROUTES.GET_INVENTORY_VALUE_TREND,
  [jwtMiddleware],
  get_inventory_value_trend,
);
router.post(ROUTES.GET_TOP_PRODUCTS, [jwtMiddleware], get_top_products);
router.post(
  ROUTES.GET_PRODUCT_PERFORMANCE,
  [jwtMiddleware],
  get_product_performance,
);
router.post(ROUTES.GET_STOCK_MOVEMENTS, [jwtMiddleware], get_stock_movements);
router.post(
  ROUTES.EXPORT_ANALYTICS_REPORT,
  [jwtMiddleware],
  export_analytics_report,
);

module.exports = { analyticsRouter: router };
