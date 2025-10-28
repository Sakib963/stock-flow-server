const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { categoryRouter } = require("./category/route");
const { supplier_dealer_router } = require("./supplier_dealer/route");
const { productRouter } = require("./product/route");
const { warehouse_router } = require("./warehouse/route");
const { subCategoryRouter } = require("./sub_category/route");
const { supplier_router } = require("./supplier/route");
const { aisleRouter } = require("./aisle/route");
const { purchaseRouter } = require("./purchase/route");
const { inventoryOverviewRouter } = require("./inventory_overview/route");
const { attendanceRouter } = require("./attendance/route");
const { invoiceRouter } = require("./invoice/route");
const { productReturnRouter } = require("./product-return/route");
const { disposeRouter } = require("./product_dispose/route");
const { managerDashboardRouter } = require("./dashboard/route");

const router = Router();

// Nest user routes under `/user`
router.use(SUB_CONTEXTS.CATEGORY, categoryRouter);
router.use(SUB_CONTEXTS.SUB_CATEGORY, subCategoryRouter);
router.use(SUB_CONTEXTS.SUPPLIER, supplier_router);
router.use(SUB_CONTEXTS.SUPPLIER_DEALER, supplier_dealer_router);
router.use(SUB_CONTEXTS.PRODUCT, productRouter);
router.use(SUB_CONTEXTS.WAREHOUSE, warehouse_router);
router.use(SUB_CONTEXTS.AISLE, aisleRouter);
router.use(SUB_CONTEXTS.PURCHASE, purchaseRouter);
router.use(SUB_CONTEXTS.INVENTORY_OVERVIEW, inventoryOverviewRouter);
router.use(SUB_CONTEXTS.ATTENDANCE, attendanceRouter);
router.use(SUB_CONTEXTS.INVOICE, invoiceRouter);
router.use(SUB_CONTEXTS.PRODUCT_RETURN, productReturnRouter);
router.use(SUB_CONTEXTS.PRODUCT_DISPOSE, disposeRouter);
router.use(SUB_CONTEXTS.DASHBOARD, managerDashboardRouter);
router.use(SUB_CONTEXTS.REPORTS, reportsRouter);

// If you have other routes, you can add them here.
// Example: adminRouter.use("/other-module", otherModuleRouter);

module.exports = { managerRouter: router };
