const { Router } = require("express");
const { adminRouter } = require("./admin/routes");
const { CONTEXTS } = require("../utils/constant");
const { authRouter } = require("./auth/routes");
const { managerRouter } = require("./manager/route");

const mainRouter = Router();

mainRouter.use(CONTEXTS.AUTH, authRouter);
mainRouter.use(CONTEXTS.ADMIN, adminRouter);
mainRouter.use(CONTEXTS.MANAGER, managerRouter );

module.exports = mainRouter;
