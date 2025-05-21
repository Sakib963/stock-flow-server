const { Router } = require("express");
const { attendanceRouter } = require("./attendance/route");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { saleRouter } = require("./sale/route");

const router = Router();

// Nest user routes under `/user`
router.use(SUB_CONTEXTS.ATTENDANCE, attendanceRouter);
router.use(SUB_CONTEXTS.SALE, saleRouter);

// If you have other routes, you can add them here.
// Example: adminRouter.use("/other-module", otherModuleRouter);

module.exports = { salesmanRouter: router };
