const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { purchaseOrderRouter } = require("./purchase-order/route");

const router = Router();

// Nest user routes under `/user`
router.use(SUB_CONTEXTS.PURCHASE_ORDER, purchaseOrderRouter);

module.exports = { inventoryRouter: router };
