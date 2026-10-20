const { Router } = require("express");
const { adminRouter } = require("./admin/routes");
const { CONTEXTS } = require("../utils/constant");
const { authRouter } = require("./auth/routes");
const { profileRouter } = require("./profile/route");
const { configurationRouter } = require("./configuration/routes");
const { activityLogRouter } = require("./activity-log/route");
const { inventoryRouter } = require("./inventory/route");
const { salesRouter } = require("./sales/route");
const { marketingRouter } = require("./marketing/route");
const { dashboardRouter } = require("./dashboard/route");
const { systemRouter } = require("./system/routes");
const { reportRouter } = require("./report/route");

const mainRouter = Router();

mainRouter.use(CONTEXTS.AUTH, authRouter);
mainRouter.use(CONTEXTS.ADMIN, adminRouter);
mainRouter.use(CONTEXTS.PROFILE, profileRouter);
mainRouter.use(CONTEXTS.CONFIGURATION, configurationRouter);
mainRouter.use(CONTEXTS.ACTIVITY_LOG, activityLogRouter);
mainRouter.use(CONTEXTS.INVENTORY, inventoryRouter);
mainRouter.use(CONTEXTS.SALES, salesRouter);
mainRouter.use(CONTEXTS.MARKETING, marketingRouter);
mainRouter.use(CONTEXTS.DASHBOARD, dashboardRouter);
mainRouter.use(CONTEXTS.SYSTEM, systemRouter);
mainRouter.use(CONTEXTS.REPORT, reportRouter);

module.exports = mainRouter;
