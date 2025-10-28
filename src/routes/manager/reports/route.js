const { Router } = require("express");
const { ROUTES } = require("../../../utils/constant");
const { current_stock_report_schema, product_wise_stock_report_schema } = require("./schema");
const get_current_stock_report = require("./controller/get-current-stock-report");
const jwtMiddleware = require("../../../utils/validate-jwt");
const { validator } = require("../../../utils/validator");
const get_low_stock_report = require("./controller/get-low-stock-report");
const get_product_wise_stock_report = require("./controller/get-product-wise-stock-report");

const router = Router();

router.post(
      ROUTES.GET_CURRENT_STOCK_REPORT,
      [jwtMiddleware, validator.get(current_stock_report_schema)],
      get_current_stock_report
);

router.post(
      ROUTES.GET_LOW_STOCK_REPORT,
      [jwtMiddleware, validator.get(current_stock_report_schema)],
      get_low_stock_report
);

router.post(
      ROUTES.GET_PRODUCT_WISE_STOCK_REPORT,
      [jwtMiddleware, validator.get(product_wise_stock_report_schema)],
      get_product_wise_stock_report
);


module.exports = { reportsRouter: router };