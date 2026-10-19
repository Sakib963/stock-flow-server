const { Router } = require("express");
const { userRouter } = require("./user/route");
const { featureRouter } = require("./feature/route");
const { roleRouter } = require("./role/route");
const { SUB_CONTEXTS } = require("../../utils/constant");

const router = Router();

// Nest user routes under `/user`
router.use(SUB_CONTEXTS.USER, userRouter);
router.use(SUB_CONTEXTS.FEATURE, featureRouter);
router.use(SUB_CONTEXTS.ROLE, roleRouter);

// If you have other routes, you can add them here.
// Example: adminRouter.use("/other-module", otherModuleRouter);

module.exports = { adminRouter: router };
