const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { posRouter } = require("./pos/route");
const { onlineRouter } = require("./online/route");
const { orderRouter } = require("./order/route");
const { deliveryRouter } = require("./delivery/route");
const { preOrderRouter } = require("./pre-order/route");
const { returnRouter } = require("./return/route");

const router = Router();

// Sales & Orders module (revamp). POS + online orders on the `orders` spine.
router.use(SUB_CONTEXTS.POS, posRouter);
router.use(SUB_CONTEXTS.ONLINE, onlineRouter);
router.use(SUB_CONTEXTS.ORDER, orderRouter);
router.use(SUB_CONTEXTS.DELIVERY, deliveryRouter);
// Pre-order: part of the sales process, but on its own tables -- never the
// `orders` spine, so bookings stay out of orders, revenue, stock and delivery.
router.use(SUB_CONTEXTS.PRE_ORDER, preOrderRouter);
// Returns: raised from an order, recorded Pending, and only moved into stock on
// an explicit confirm.
router.use(SUB_CONTEXTS.RETURN, returnRouter);

module.exports = { salesRouter: router };
