const { Router } = require("express");
const { userRouter } = require("./user/routes");
const { SUB_CONTEXTS } = require("../../utils/constant");

const router = Router();

// Nest user routes under `/user`
router.use(SUB_CONTEXTS.USER, userRouter);

// If you have other routes, you can add them here.
// Example: adminRouter.use("/other-module", otherModuleRouter);

module.exports = { adminRouter: router };
