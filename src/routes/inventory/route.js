const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { purchaseOrderRouter } = require("./purchase-order/route");
const { inventoryOverviewRouter } = require("./overview/route");
const { productDisposeRouter } = require("./product-dispose/route");

const router = Router();

router.use(SUB_CONTEXTS.PURCHASE_ORDER, purchaseOrderRouter);
router.use(SUB_CONTEXTS.INVENTORY_OVERVIEW, inventoryOverviewRouter);
router.use(SUB_CONTEXTS.PRODUCT_DISPOSE, productDisposeRouter);

module.exports = { inventoryRouter: router };
