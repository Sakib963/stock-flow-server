const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { posRouter } = require("./pos/route");
const { onlineRouter } = require("./online/route");
const { orderRouter } = require("./order/route");
const { deliveryRouter } = require("./delivery/route");

const router = Router();

// Sales & Orders module (revamp). POS + online orders on the `orders` spine.
router.use(SUB_CONTEXTS.POS, posRouter);
router.use(SUB_CONTEXTS.ONLINE, onlineRouter);
router.use(SUB_CONTEXTS.ORDER, orderRouter);
router.use(SUB_CONTEXTS.DELIVERY, deliveryRouter);

module.exports = { salesRouter: router };
