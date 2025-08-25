const { Router } = require("express");
const { adminRouter } = require("./admin/routes");
const { CONTEXTS } = require("../utils/constant");
const { authRouter } = require("./auth/routes");
const { managerRouter } = require("./manager/route");
const { salesmanRouter } = require("./salesman/route");
const { profileRouter } = require("./profile/route");

const mainRouter = Router();

mainRouter.use(CONTEXTS.AUTH, authRouter);
mainRouter.use(CONTEXTS.ADMIN, adminRouter);
mainRouter.use(CONTEXTS.MANAGER, managerRouter);
mainRouter.use(CONTEXTS.SALESMAN, salesmanRouter);
mainRouter.use(CONTEXTS.PROFILE, profileRouter);

module.exports = mainRouter;
