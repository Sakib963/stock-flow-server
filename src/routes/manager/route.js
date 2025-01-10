const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { categoryRouter } = require("./category/route");
const { supplier_dealer_router } = require("./supplier_dealer/route");

const router = Router();

// Nest user routes under `/user`
router.use(SUB_CONTEXTS.CATEGORY, categoryRouter);
// Nest user routes under `/user`
router.use(SUB_CONTEXTS.SUPPLIER_DEALER, supplier_dealer_router);

// If you have other routes, you can add them here.
// Example: adminRouter.use("/other-module", otherModuleRouter);

module.exports = { managerRouter: router };
