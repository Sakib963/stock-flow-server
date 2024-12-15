const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { categoryRouter } = require("./category/route");

const router = Router();

// Nest user routes under `/user`
router.use(SUB_CONTEXTS.CATEGORY, categoryRouter);

// If you have other routes, you can add them here.
// Example: adminRouter.use("/other-module", otherModuleRouter);

module.exports = { managerRouter: router };
