const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { purchaseOrderRouter } = require("./purchase-order/route");
const { inventoryOverviewRouter } = require("./overview/route");
const { productDisposeRouter } = require("./product-dispose/route");
const { stockMovementRouter } = require("./stock-movement/route");
const { stockAdjustmentRouter } = require("./stock-adjustment/route");

const router = Router();

router.use(SUB_CONTEXTS.PURCHASE_ORDER, purchaseOrderRouter);
router.use(SUB_CONTEXTS.INVENTORY_OVERVIEW, inventoryOverviewRouter);
router.use(SUB_CONTEXTS.PRODUCT_DISPOSE, productDisposeRouter);
router.use(SUB_CONTEXTS.STOCK_MOVEMENT, stockMovementRouter);
router.use(SUB_CONTEXTS.STOCK_ADJUSTMENT, stockAdjustmentRouter);

module.exports = { inventoryRouter: router };
