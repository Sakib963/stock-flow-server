const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { salesReportRouter } = require("./sales/route");
const { stockReportRouter } = require("./stock/route");
const { customerReportRouter } = require("./customer/route");
const { marketingReportRouter } = require("./marketing/route");

const router = Router();

router.use(SUB_CONTEXTS.SALES_REPORT, salesReportRouter);
router.use(SUB_CONTEXTS.STOCK_REPORT, stockReportRouter);
router.use(SUB_CONTEXTS.CUSTOMER_REPORT, customerReportRouter);
router.use(SUB_CONTEXTS.MARKETING_REPORT, marketingReportRouter);

module.exports = { reportRouter: router };
