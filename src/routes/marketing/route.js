const { Router } = require("express");
const { SUB_CONTEXTS } = require("../../utils/constant");
const { partnerRouter } = require("./partner/route");
const { campaignRouter } = require("./campaign/route");
const { partnerPaymentRouter } = require("./partner-payment/route");

const router = Router();

router.use(SUB_CONTEXTS.PARTNER, partnerRouter);
router.use(SUB_CONTEXTS.CAMPAIGN, campaignRouter);
router.use(SUB_CONTEXTS.PARTNER_PAYMENT, partnerPaymentRouter);

module.exports = { marketingRouter: router };
